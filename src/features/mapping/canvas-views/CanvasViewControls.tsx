import { useState, useSyncExternalStore } from 'react';
import type { CanvasViewCommand } from '../../../../domain/core/diagrams/canvasView';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { CanvasViewRequest } from './canvasViewReceiver';
import './canvasViews.css';

export function CanvasViewControls({ controller, onCommand, disabled, canvasName, previewViewId, onPreview }: {
  controller: MappingDocumentController; canvasName: string; disabled?: boolean; onCommand: (request: CanvasViewRequest) => Promise<unknown>;
  previewViewId?: string; onPreview: (viewId?: string) => void;
}) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { saved, recording } = controller.canvasViews(), views = Object.values(saved);
  const [name, setName] = useState(''), [selected, setSelected] = useState(previewViewId ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState<CanvasViewRequest>();
  const viewId = saved[selected] ? selected : views[0]?.id;
  const send = async (request: CanvasViewRequest) => {
    setBusy(true); setError('');
    try { await onCommand(request); setRetry(undefined); if (['apply', 'delete', 'start'].includes(request.operation)) onPreview(); }
    catch (error) { const message = String(error); setError(message); setRetry(message.includes('PERSISTENCE_PENDING') ? request : undefined); }
    finally { setBusy(false); }
  };
  const command = (input: CanvasViewCommand) => {
    controller.settlePendingGesture();
    void send({ ...input, requestId: crypto.randomUUID(), expectedVersion: controller.getSnapshot().version });
  };
  return <section className="canvas-view-controls" aria-label="Canvas views" data-mapping-static-ui data-diagram-canvas-static-ui>
    <h2>Views</h2>
    <p>{canvasName}</p>
    <fieldset disabled={disabled || busy || !!retry}>
      {recording ? <span role="status">Recording: {recording.name}</span>
        : <label>New view<input aria-label="Canvas view name" placeholder="View name" maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>}
      <button type="button" aria-pressed={!!recording} disabled={!recording && !name.trim()}
        onClick={() => command(recording ? { operation: 'stop' } : { operation: 'start', name })}>{recording ? 'Stop & save' : 'Record view'}</button>
      {recording && <button type="button" onClick={() => command({ operation: 'cancel' })}>Cancel recording</button>}
      <label>Saved views<select aria-label="Saved canvas view" value={viewId ?? ''} onChange={event => {
        setSelected(event.target.value); if (previewViewId) onPreview(event.target.value);
      }} disabled={!views.length}>
        {!views.length && <option value="">No saved views</option>}
        {views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select></label>
      {viewId && <p>{saved[viewId].checkpointIds.length - 1} recorded {saved[viewId].checkpointIds.length === 2 ? 'change' : 'changes'}</p>}
      <label className="canvas-view-diff-toggle"><input type="checkbox" checked={!!previewViewId} disabled={!viewId || !!recording}
        onChange={event => onPreview(event.target.checked ? viewId : undefined)} />Show diagram diff</label>
      {previewViewId && <p>Recording start → end. Preview only; the live canvas is unchanged.</p>}
      <button type="button" disabled={!viewId || !!recording} onClick={() => command({ operation: 'apply', viewId })}>Apply view</button>
      <button type="button" disabled={!viewId} onClick={() => command({ operation: 'delete', viewId })}>Delete view</button>
    </fieldset>
    <p>Record canvas changes, then stop to save. Apply restores a saved view in one undoable step.</p>
    {retry && <button type="button" disabled={busy || disabled} onClick={() => void send(retry)}>Retry save</button>}
    {error && <div role="alert">{error}</div>}
  </section>;
}
