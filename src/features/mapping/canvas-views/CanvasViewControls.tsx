import { GenerateAlternatives, GenerationDetails, generationLabel, useGenerations } from './GenerateAlternatives';
import { generationRunning } from '../../../../domain/core/diagrams/canvasGeneration';
import type { ChatCanvasTarget } from '../../../../domain/mapping/agent-chat/agentChat';
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type { CanvasView, CanvasViewCommand } from '../../../../domain/core/diagrams/canvasView';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { CanvasViewRequest } from './canvasViewReceiver';
import { ExplorerSection, Icon, IconButton } from './ExplorerSection';
import './canvasViews.css';

/** An inline editor row in the tree, like VS Code's "New File" input. */
type Draft = { kind: 'create' | 'fork'; name: string } | { kind: 'alternatives'; count: number };

export function CanvasViewControls({ controller, onCommand, disabled, canvasName, onPreview, canvasTarget, onOpenChat }: {
  canvasTarget?: ChatCanvasTarget; onOpenChat?: (id: string) => void;
  controller: MappingDocumentController; canvasName: string; disabled?: boolean; onCommand: (request: CanvasViewRequest) => Promise<unknown>;
  previewViewId?: string; onPreview: (viewId?: string) => void;
}) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { saved, recording, activeViewId, dirty } = controller.canvasViews();
  const views = Object.values(saved).filter(view => !view.archivedAt), active = activeViewId ? saved[activeViewId] : undefined;
  const statuses = useGenerations(canvasTarget, views.some(view => !!view.generation));
  const [generationSelection, setGenerationSelection] = useState<string>();
  const generationFor = (view: CanvasView) => statuses.find(status => status.viewId === view.id) ?? (view.generation ? { ...view.generation, viewId: view.id } : undefined);
  const selectedGeneration = generationSelection && saved[generationSelection] ? generationFor(saved[generationSelection]) : active ? generationFor(active) : undefined;
  const [draft, setDraft] = useState<Draft>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()), [focused, setFocused] = useState('');
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [retry, setRetry] = useState<CanvasViewRequest>();
  const locked = disabled || busy || !!retry;
  useEffect(() => {
    if (!activeViewId) return;
    setFocused(activeViewId); setGenerationSelection(undefined);
    setCollapsed(previous => {
      const next = new Set(previous); let parent = saved[activeViewId]?.parentViewId;
      while (parent) { next.delete(parent); parent = saved[parent]?.parentViewId; }
      return next;
    });
  }, [activeViewId]); // Saved view identities are immutable; only a new active view needs revealing.
  const send = async (request: CanvasViewRequest) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await onCommand(request); setRetry(undefined); onPreview(); setDraft(undefined);
      const state = controller.canvasViews();
      if (request.operation === 'save' || request.operation === 'keep')
        setNotice(`Saved ${state.saved[state.activeViewId!].name}.${request.operation === 'keep' ? ' Other alternatives archived.' : ''}`);
      if (request.operation === 'alternatives') {
        setCollapsed(previous => { const next = new Set(previous); next.delete(request.viewId!); return next; });
        setNotice(`Created ${request.names!.length} alternatives. Open one to edit it, or ask AgentChat to edit each alternative.`);
      }
    } catch (error) {
      const message = String(error); setError(message); setRetry(message.includes('PERSISTENCE_PENDING') ? request : undefined);
    } finally { setBusy(false); }
  };
  const command = (input: CanvasViewCommand) => {
    controller.settlePendingGesture();
    void send({ ...input, requestId: crypto.randomUUID(), expectedVersion: controller.getSnapshot().version });
  };
  const children = (parent?: string) => views.filter(view => view.parentViewId === parent);
  const visible: CanvasView[] = [];
  const collect = (parent?: string) => { for (const view of children(parent)) { visible.push(view); if (!collapsed.has(view.id)) collect(view.id); } };
  collect();
  const toggle = (id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const focus = (id?: string) => { if (id) { setFocused(id); rows.current.get(id)?.focus(); } };
  const open = (viewId: string) => { setGenerationSelection(saved[viewId].generation ? viewId : undefined);
    if (!locked && !recording && !generationRunning(saved[viewId].generation)) command({ operation: 'open', viewId }); };
  const save = () => { if (active && !locked && !recording) command({ operation: 'save' }); };
  const saveShortcut = useRef(save); saveShortcut.current = save;
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault(); saveShortcut.current();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  const startDraft = (next: Draft) => {
    setError(''); setNotice(''); setDraft(next);
    if (next.kind !== 'create' && activeViewId) setCollapsed(previous => { const set = new Set(previous); set.delete(activeViewId); return set; });
  };
  const alternativeNames = (count: number) => {
    const used = new Set(views.map(view => view.name)), names: string[] = [];
    for (let i = 1; names.length < count; i++) {
      const name = `${active!.name.slice(0, 108)}.${i}`;
      if (!used.has(name)) names.push(name);
    }
    return names;
  };
  const submitDraft = () => {
    if (!draft || locked || recording) return;
    if (draft.kind === 'create' && draft.name.trim()) command({ operation: 'create', name: draft.name });
    if (draft.kind === 'fork' && active) command({ operation: 'fork', viewId: activeViewId, name: draft.name.trim() || `${active.name.slice(0, 115)} copy` });
  };
  const navigate = (event: KeyboardEvent, view: CanvasView) => {
    if (event.target !== event.currentTarget || locked) return;
    const index = visible.findIndex(item => item.id === view.id), descendants = children(view.id);
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'ArrowDown') focus(visible[index + 1]?.id);
    if (event.key === 'ArrowUp') focus(visible[index - 1]?.id);
    if (event.key === 'Home') focus(visible[0]?.id);
    if (event.key === 'End') focus(visible.at(-1)?.id);
    if (event.key === 'ArrowRight' && descendants.length) { if (collapsed.has(view.id)) toggle(view.id); else focus(descendants[0].id); }
    if (event.key === 'ArrowLeft') { if (descendants.length && !collapsed.has(view.id)) toggle(view.id); else focus(view.parentViewId); }
    if (event.key === 'Enter' || event.key === ' ') open(view.id);
  };
  const guides = (depth: number) => Array.from({ length: depth }, (_, i) => <span key={i} className="canvas-view-guide" />);
  const draftRow = (depth: number) => {
    if (!draft) return null;
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); submitDraft(); }
      if (event.key === 'Escape') { event.preventDefault(); setDraft(undefined); focus(activeViewId); }
      event.stopPropagation();
    };
    if (draft.kind === 'alternatives') return <li role="none">{canvasTarget && activeViewId ?
      <GenerateAlternatives canvas={canvasTarget} viewId={activeViewId} names={alternativeNames(draft.count)} onCancel={() => setDraft(undefined)}
        onDone={() => { setDraft(undefined); setNotice(''); }} /> : <p>Connect a live canvas to generate alternatives.</p>}</li>;
    const label = draft.kind === 'create' ? 'Save as view' : 'Fork view';
    return <li role="none" className="canvas-view-draft">
      <div className="canvas-view-row is-editing">
        {guides(depth)}<span className="canvas-view-chevron-spacer" />
        <Icon name="view" />
        <input autoFocus aria-label="Canvas view name" placeholder={draft.kind === 'fork' ? 'Fork name' : 'View name'} maxLength={120} value={draft.name}
          onFocus={event => event.target.select()} onKeyDown={keys} onChange={event => setDraft({ kind: draft.kind, name: event.target.value })} />
        <IconButton icon="keep" label={label} disabled={!!recording || draft.kind === 'create' && !draft.name.trim()} onClick={submitDraft} />
        <IconButton icon="close" label="Cancel" onClick={() => setDraft(undefined)} />
      </div>
      {draft.kind !== 'create' && dirty && <p className="canvas-view-hint" style={{ paddingLeft: 22 + depth * 12 }}>
        Starts from the last saved version of {active?.name}. Save first to include unsaved changes.</p>}
    </li>;
  };
  const render = (view: CanvasView, depth: number): ReactNode => {
    const descendants = children(view.id), current = activeViewId === view.id;
    const editingHere = current && draft && draft.kind !== 'create', expanded = !collapsed.has(view.id) || !!editingHere;
    return <li key={view.id} role="treeitem" aria-label={view.name} aria-selected={current} aria-level={depth + 1}
      aria-expanded={descendants.length ? expanded : undefined} aria-disabled={!!locked || !!recording}
      tabIndex={view.id === (visible.some(item => item.id === focused) ? focused : visible[0]?.id) ? 0 : -1}
      ref={element => { if (element) rows.current.set(view.id, element); else rows.current.delete(view.id); }}
      onKeyDown={event => navigate(event, view)} onFocus={event => { if (event.target === event.currentTarget) setFocused(view.id); }}>
      <div className={`canvas-view-row${current ? ' is-active' : ''}`} title={view.name} onClick={() => { focus(view.id); open(view.id); }}>
        {guides(depth)}
        <button className="canvas-view-chevron" tabIndex={-1} aria-label={`${expanded ? 'Collapse' : 'Expand'} view ${view.name}`}
          disabled={locked || !descendants.length} style={{ visibility: descendants.length ? 'visible' : 'hidden' }}
          onClick={event => { event.stopPropagation(); focus(view.id); toggle(view.id); }}><Icon name="chevron" /></button>
        <Icon name="view" />
        <span className="canvas-view-name">{view.name}</span>
        {view.generation && <span className="canvas-generation-badge" data-generation-status={generationFor(view)!.status}>{generationLabel(generationFor(view)!)}</span>}
        {current && dirty && <span className="canvas-view-dirty" title="Unsaved changes" aria-label="Unsaved changes" />}
        {current && <span className="canvas-view-row-actions" onClick={event => event.stopPropagation()}>
          <IconButton icon="fork" label="Fork view…" disabled={locked || !!recording} onClick={() => startDraft({ kind: 'fork', name: `${view.name.slice(0, 115)} copy` })} />
          <IconButton icon="alternatives" label="Generate alternatives…" disabled={locked || !!recording} onClick={() => startDraft({ kind: 'alternatives', count: 3 })} />
          {view.alternativeGroupId && <IconButton icon="keep" label="Keep this alternative" disabled={locked || !!recording} onClick={() => command({ operation: 'keep', viewId: activeViewId })} />}
          <IconButton icon="discard" label="Discard view" className="is-danger" disabled={locked || !!recording} onClick={() => command({ operation: 'discard', viewId: activeViewId })} />
        </span>}
      </div>
      {(descendants.length > 0 || editingHere) && expanded && <ul role="group">
        {editingHere && draftRow(depth + 1)}
        {descendants.map(child => render(child, depth + 1))}
      </ul>}
    </li>;
  };
  const siblings = active ? views.filter(view => active.alternativeGroupId ? view.alternativeGroupId === active.alternativeGroupId : view.parentViewId === active.parentViewId) : [];
  const position = siblings.findIndex(view => view.id === activeViewId);
  const cycle = (direction: number) => open(siblings[(position + direction + siblings.length) % siblings.length].id);
  return <div className="canvas-view-controls" aria-label="Canvas views" data-mapping-static-ui data-diagram-canvas-static-ui>
    <ExplorerSection title="Views" actions={<>
      <IconButton icon="add" label="New view…" disabled={locked || !!recording} onClick={() => startDraft({ kind: 'create', name: '' })} />
      <IconButton icon="collapse" label="Collapse all views" disabled={!views.length}
        onClick={() => setCollapsed(new Set(views.filter(view => children(view.id).length).map(view => view.id)))} />
    </>}>
      <fieldset disabled={locked}>
        <p className="canvas-view-canvas" title={canvasName}>{canvasName}</p>
        <ul role="tree" aria-label="Canvas view explorer" className="canvas-view-tree">
          {children().map(view => render(view, 0))}
          {draft?.kind === 'create' && draftRow(0)}
        </ul>
        {!views.length && !draft && <div className="canvas-view-empty">
          <p>No saved views yet. Save the current canvas as your first view.</p>
          <button type="button" onClick={() => startDraft({ kind: 'create', name: '' })}>Save canvas as view…</button>
        </div>}
      </fieldset>
      {views.some(view => generationRunning(generationFor(view))) && <p role="status" className="canvas-view-notice">Generating alternatives… {views.filter(view => generationFor(view)?.status === 'finished').length} finished</p>}
      {selectedGeneration && <GenerationDetails generation={selectedGeneration} onOpenChat={onOpenChat} />}
      {notice && <p className="canvas-view-notice" role="status">{notice}</p>}
      {retry && <button type="button" className="canvas-view-retry" disabled={busy || disabled} onClick={() => void send(retry)}>Retry save</button>}
      {error && <div className="canvas-view-error" role="alert">{error}</div>}
    </ExplorerSection>
    {active && <div className="canvas-view-footer">
      <div className="canvas-view-status">
        <p className="canvas-view-current">Editing <strong>{active.name}</strong>{dirty ? ' · Unsaved changes' : ' · Saved'}</p>
        {siblings.length > 1 && <span className="canvas-view-cycle">
          <IconButton icon="previous" label="Previous view" disabled={locked || !!recording} onClick={() => cycle(-1)} />
          <span aria-label={`View ${position + 1} of ${siblings.length}`}>{position + 1}/{siblings.length}</span>
          <IconButton icon="next" label="Next view" disabled={locked || !!recording} onClick={() => cycle(1)} />
        </span>}
      </div>
      <button type="button" className={`canvas-view-save${dirty ? ' is-dirty' : ''}`} aria-label="Save view" title="Save view (Ctrl+S)"
        disabled={locked || !!recording} onClick={save}><Icon name="save" />Save view<kbd>Ctrl+S</kbd></button>
    </div>}
  </div>;
}
