import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { DiagramEditCoordinator, editUnsettled } from './diagramEditCoordinator';
import './diagramEdit.css';

export function DiagramEditComposer({ coordinator }: { coordinator: DiagramEditCoordinator }) {
  const { entries, activeKey } = useStore(coordinator.store);
  const entry = activeKey ? entries[activeKey] : undefined;
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (activeKey) textarea.current?.focus(); }, [activeKey]);
  const keys = Object.keys(entries);
  if (!keys.length) return null;
  if (!entry || !activeKey) return <div className="diagram-edit-launcher" data-mapping-static-ui data-diagram-canvas-static-ui>
    {keys.map(key => <div key={key}>
      <button onClick={() => coordinator.show(key)}>Diagram update: {entries[key].target.label}
        {entries[key].run ? ` (${entries[key].run!.status})` : ''}</button>
      {!editUnsettled(entries[key]) && <button aria-label={`Dismiss diagram update for ${entries[key].target.label}`}
        onClick={() => coordinator.dismiss(key)}>Dismiss</button>}
    </div>)}
  </div>;
  const locked = editUnsettled(entry), status = entry.run?.status;
  const message = status === 'completed' ? 'Diagram updated and workspace saved. You can undo this change.'
    : status === 'conflict' ? 'The canvas changed before the update could be applied. Your prompt is preserved; submit again using the latest diagram.'
    : status === 'awaiting-acknowledgement' ? 'The update may already be applied. Retry confirmation to finish safely.'
    : status === 'cancelled' ? 'Update cancelled before application.'
    : status === 'failed' ? 'The diagram update failed. Your prompt is preserved.'
    : status === 'applying' ? 'Applying and saving the updated diagram…'
    : status === 'generating' ? entry.run?.message || 'Generating diagram update…'
    : entry.pending ? 'Preparing diagram update…' : 'Describe how this diagram should change.';
  return <section className="diagram-edit-composer" role="dialog" aria-label="Update diagram with AI" aria-modal="false"
    data-mapping-static-ui data-diagram-canvas-static-ui onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); coordinator.close(); }
    }}>
    <header><h2>Update diagram with AI</h2><button aria-label={locked ? "Hide diagram update" : "Close diagram update"} onClick={() => coordinator.close()}>{locked ? "Hide" : "Close"}</button></header>
    <p className="diagram-edit-target"><strong>{entry.target.label}</strong><br />Scope: whole diagram. This target stays fixed when selection changes.</p>
    <form onSubmit={event => { event.preventDefault(); void coordinator.submit(activeKey); }}>
      <label htmlFor="diagram-edit-prompt">Requested changes</label>
      <textarea ref={textarea} id="diagram-edit-prompt" rows={5} maxLength={20000} value={entry.prompt} disabled={locked}
        placeholder="e.g. add the persistence service beneath its owning controller"
        onChange={event => coordinator.setPrompt(activeKey, event.target.value)} />
      <p role="status" aria-live="polite" data-edit-status={status ?? (entry.pending ? 'preparing' : 'composing')}>{message}</p>
      {(entry.error || entry.run?.error) && <p role="alert">{entry.error ?? entry.run?.error}</p>}
      {!!entry.run?.result?.unresolvedEdgeIds.length && <p role="alert">Some connections need their endpoints repaired: {entry.run.result.unresolvedEdgeIds.join(', ')}</p>}
      <footer>
        {!locked && !status && <button type="button" onClick={() => coordinator.close()}>Cancel</button>}
        {status === 'generating' && <button type="button" disabled={entry.pending} onClick={() => void coordinator.cancel(activeKey)}>Cancel update</button>}
        {(status === 'awaiting-acknowledgement' || entry.error && locked) && <button type="button" disabled={entry.pending}
          onClick={() => void coordinator.retry(activeKey)}>{status === 'awaiting-acknowledgement' ? 'Retry confirmation' : entry.run ? 'Refresh status' : 'Retry request'}</button>}
        {!locked && <button type="submit" disabled={!entry.prompt.trim()}>{status === 'conflict' ? 'Update latest diagram' : 'Update diagram'}</button>}
      </footer>
    </form>
    {keys.length > 1 && <nav aria-label="Other diagram updates">{keys.filter(key => key !== activeKey).map(key =>
      <button key={key} onClick={() => coordinator.show(key)}>{entries[key].target.label}</button>)}</nav>}
  </section>;
}
