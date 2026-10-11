import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import type { PromptReference } from '../../../../domain/mapping/agent/diagramEdit';
import { findPromptTemplate, promptTemplateCatalog, promptTemplates, type PromptTemplateParameter } from '../../../../domain/mapping/agent/promptTemplates';
import { WindowPanel } from '../window-panel/WindowPanel';
import { usePanelLayout } from '../window-panel/windowPanelState';
import { TemplateEditor } from './TemplateEditor';
import { composerUnsettled, type PromptComposerCoordinator, type PromptComposerEntry, type PromptComposerTarget } from './promptComposerCoordinator';
import { draftReferences, maxPromptCount, referenceSummary, removeBlock, selectTemplate, serializePromptDraft, setBlockText, setCount,
  setTemplateMarkdown, setTemplateOption, insertReference, type PromptBlock } from './promptDraft';
import { copyPromptReferences, pastedPromptReferences } from './promptReferences';
import { maxRevisionNameLength, renameRevision, revisionNames } from './revisionNames';
import './promptComposer.css';

/** One immutable revision of the target diagram, newest first. sequence numbers the revision chain from 1. */
export interface PromptRevision { id: string; diagramId: string; sequence: number; current: boolean; title: string; ascii: string }
export interface PromptRevisionSource {
  list(target: PromptComposerTarget): PromptRevision[];
  sequence(revisionId: string): number | undefined;
}
type Pane = 'prompt' | 'revisions';
const panes = ['prompt', 'revisions'] as const, modes = ['full-single', 'full-split'] as const;
const promptLimit = 20000;
const measure = typeof document === 'undefined' ? undefined! : document.createElement('canvas');

export function revisionReference(revision: PromptRevision): PromptReference {
  return { kind: 'diagram', label: revision.title, diagramId: revision.diagramId, revisionId: revision.id };
}
function useRevisionTag(source: PromptRevisionSource) {
  const names = useStore(revisionNames, state => state.names);
  return (revisionId: string) => names[revisionId] ?? (source.sequence(revisionId) ? `r${source.sequence(revisionId)}` : revisionId.slice(-6));
}

export function PromptComposer({ coordinator, revisions }: { coordinator: PromptComposerCoordinator; revisions: PromptRevisionSource }) {
  const { entries, activeKey } = useStore(coordinator.store);
  const entry = activeKey ? entries[activeKey] : undefined;
  const keys = Object.keys(entries);
  if (!keys.length) return null;
  if (!entry || !activeKey) return <div className="prompt-composer-launcher" data-mapping-static-ui data-diagram-canvas-static-ui>
    {keys.map(key => <div key={key}>
      <button type="button" onClick={() => coordinator.show(key)}>{entries[key].target.operation === 'create-diagram' ? 'Diagram creation' : 'Diagram update'}: {entries[key].target.label}
        {entries[key].run ? ` (${entries[key].run!.status})` : ''}</button>
      {!composerUnsettled(entries[key]) && <button type="button" aria-label={`Dismiss ${entries[key].target.label}`}
        onClick={() => coordinator.dismiss(key)}>Dismiss</button>}
    </div>)}
  </div>;
  return <ComposerWindow key={activeKey} coordinator={coordinator} entryKey={activeKey} entry={entry} revisions={revisions}
    others={keys.filter(key => key !== activeKey).map(key => ({ key, label: entries[key].target.label }))} />;
}

function ComposerWindow({ coordinator, entryKey, entry, revisions, others }: { coordinator: PromptComposerCoordinator; entryKey: string;
  entry: PromptComposerEntry; revisions: PromptRevisionSource; others: { key: string; label: string }[] }) {
  const [layout, setLayout] = usePanelLayout<Pane>('prompt-composer-layout', panes, modes);
  const [railOpen, setRailOpen] = useState(true);
  const carried = useStore(coordinator.store, state => state.carried);
  const create = entry.target.operation === 'create-diagram';
  const list = revisions.list(entry.target);
  // A newly shown prompt starts expanded; minimizing is for reaching the canvas during this prompt only.
  useEffect(() => { setLayout({ minimized: false }); }, [setLayout]);
  // The expanded panel covers the canvas, so canvas selection controls would float over the prompt.
  useEffect(() => {
    document.body.classList.toggle('has-prompt-composer', !layout.minimized);
    return () => document.body.classList.remove('has-prompt-composer');
  }, [layout.minimized]);
  const keyDown = (event: React.KeyboardEvent) => {
    // Typing in the composer must never trigger canvas shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); if (carried) coordinator.carry(); else coordinator.close(); }
  };
  return <>
    <WindowPanel className="prompt-composer" title={create ? 'Create diagram with AI' : 'Update diagram with AI'}
      subtitle={`Target: ${entry.target.label} · ${create ? 'new diagrams are placed beside it' : 'whole diagram'} · fixed when selection changes`}
      canvasId={entry.target.canvasId} state={layout} onChange={setLayout} onClose={() => coordinator.close()} modes={modes} canvas={null}
      notice={others.length ? <nav className="prompt-composer-others" aria-label="Other prompts">{others.map(other =>
        <button type="button" key={other.key} onClick={() => coordinator.show(other.key)}>{other.label}</button>)}</nav> : undefined}
      panes={[
        { id: 'prompt', title: 'Prompt', content: <div className="prompt-composer-pane" onKeyDown={keyDown}>
          <PromptPane coordinator={coordinator} entryKey={entryKey} entry={entry} revisions={revisions} list={list}
            railOpen={railOpen} onToggleRail={() => { setRailOpen(open => !open); if (railOpen) coordinator.carry(); }} carrying={!!carried} />
        </div> },
        { id: 'revisions', title: `Revisions (${list.length})`, content: <div className="prompt-composer-pane" onKeyDown={keyDown}>
          <RevisionsPane coordinator={coordinator} entryKey={entryKey} entry={entry} revisions={revisions} list={list}
            onInserted={() => setLayout({ pane: 'prompt', focusedPane: 'prompt' })} />
        </div> }
      ]} />
    {carried && <CarriedGhost coordinator={coordinator} reference={carried.reference} revisions={revisions} />}
  </>;
}

function statusMessage(entry: PromptComposerEntry) {
  const status = entry.run?.status, create = entry.target.operation === 'create-diagram';
  const created = entry.run?.created?.nodeIds.length ?? 0;
  return status === 'completed' ? create ? `Created ${created === 1 ? 'a diagram' : `${created} diagrams`} beside the anchor and saved the workspace. You can undo this change.`
      : 'Diagram updated and workspace saved. You can undo this change.'
    : status === 'conflict' ? 'The canvas changed before the update could be applied. Your prompt is preserved; submit again using the latest diagram.'
    : status === 'awaiting-acknowledgement' ? `The ${create ? 'diagrams' : 'update'} may already be applied. Retry confirmation to finish safely.`
    : status === 'cancelled' ? 'Cancelled before application.'
    : status === 'failed' ? `The ${create ? 'diagram creation' : 'diagram update'} failed. Your prompt is preserved.`
    : status === 'applying' ? create ? 'Placing and saving the new diagrams…' : 'Applying and saving the updated diagram…'
    : status === 'generating' ? entry.run?.message || (create ? 'Generating diagrams…' : 'Generating diagram update…')
    : entry.pending ? 'Preparing request…'
    : create ? 'Describe the diagram to create. References are pinned to the revision shown on each chip.'
    : 'Describe how this diagram should change. References are pinned to the revision shown on each chip.';
}

function PromptPane({ coordinator, entryKey, entry, revisions, list, railOpen, onToggleRail, carrying }: { coordinator: PromptComposerCoordinator;
  entryKey: string; entry: PromptComposerEntry; revisions: PromptRevisionSource; list: PromptRevision[]; railOpen: boolean; onToggleRail: () => void; carrying: boolean }) {
  const locked = composerUnsettled(entry), status = entry.run?.status, create = entry.target.operation === 'create-diagram';
  const { prompt } = serializePromptDraft(entry.draft), references = draftReferences(entry.draft);
  const update = (change: Parameters<PromptComposerCoordinator['updateDraft']>[1]) => coordinator.updateDraft(entryKey, change);
  return <div className="prompt-composer-layout">
    <form className="prompt-composer-main" onSubmit={event => { event.preventDefault(); void coordinator.submit(entryKey); }}>
      <p className="prompt-composer-heading"><span className="eyebrow">Prompt</span> Template first, then your text and references in order.</p>
      <div className="prompt-box" role="group" aria-label="Prompt draft" aria-disabled={locked}>
        <TemplateBlock entry={entry} locked={locked} update={update} instruction={prompt} referenceCount={references.length} />
        <PromptBody coordinator={coordinator} entryKey={entryKey} entry={entry} locked={locked} revisions={revisions} carrying={carrying}
          placeholder={create ? 'Describe the diagram to create, e.g. the refund path starting from the ledger service' : 'e.g. add the persistence service beneath its owning controller'} />
        <div className="prompt-box-toolbar">
          <button type="button" aria-expanded={railOpen} aria-controls={`${entryKey}-revisions`} onClick={onToggleRail}
            className={railOpen ? 'is-open' : undefined}><span aria-hidden="true" className="prompt-chevron">›</span>Insert revision</button>
          <span className="prompt-hint">Paste copied references with Ctrl+V</span>
          <span className="prompt-counter" data-over={prompt.length > promptLimit}>{references.length} refs · {prompt.length.toLocaleString()} / {promptLimit.toLocaleString()}</span>
        </div>
      </div>
      <div className="prompt-count" role="group" aria-labelledby={`${entryKey}-count`}>
        <span id={`${entryKey}-count`}>Diagrams to generate</span>
        <button type="button" aria-label="Fewer diagrams" disabled={locked || !create || entry.draft.count <= 1} onClick={() => update(draft => setCount(draft, draft.count - 1))}>−</button>
        <output aria-live="polite">{create ? entry.draft.count : 1}</output>
        <button type="button" aria-label="More diagrams" disabled={locked || !create || entry.draft.count >= maxPromptCount} onClick={() => update(draft => setCount(draft, draft.count + 1))}>+</button>
        <small>{create ? entry.draft.count === 1 ? 'One new diagram beside the anchor' : 'Each is placed beside the anchor so you can compare them'
          : 'An edit applies one revision. Create new diagrams to generate several.'}</small>
      </div>
      <p role="status" aria-live="polite" className="prompt-status" data-edit-status={status ?? (entry.pending ? 'preparing' : 'composing')}>{statusMessage(entry)}</p>
      {(entry.error || entry.run?.error) && <p role="alert" className="prompt-error">{entry.error ?? entry.run?.error}</p>}
      {!!entry.run?.result?.unresolvedEdgeIds.length && <p role="alert" className="prompt-error">Some connections need their endpoints repaired: {entry.run.result.unresolvedEdgeIds.join(', ')}</p>}
      <footer className="prompt-composer-footer">
        {!locked && !status && <button type="button" onClick={() => coordinator.close()}>Cancel</button>}
        {status === 'generating' && <button type="button" disabled={entry.pending} onClick={() => void coordinator.cancel(entryKey)}>{create ? 'Cancel creation' : 'Cancel update'}</button>}
        {(status === 'awaiting-acknowledgement' || entry.error && locked) && <button type="button" disabled={entry.pending}
          onClick={() => void coordinator.retry(entryKey)}>{status === 'awaiting-acknowledgement' ? 'Retry confirmation' : entry.run ? 'Refresh status' : 'Retry request'}</button>}
        {!locked && <button type="submit" className="prompt-primary" disabled={!prompt || prompt.length > promptLimit}>{create
          ? entry.draft.count === 1 ? 'Create diagram' : `Create ${entry.draft.count} diagrams`
          : status === 'conflict' ? 'Update latest diagram' : 'Update diagram'}</button>}
      </footer>
    </form>
    {railOpen && <RevisionRail id={`${entryKey}-revisions`} coordinator={coordinator} list={list} />}
  </div>;
}

function TemplateBlock({ entry, locked, update, instruction, referenceCount }: { entry: PromptComposerEntry; locked: boolean;
  update: (change: Parameters<PromptComposerCoordinator['updateDraft']>[1]) => void; instruction: string; referenceCount: number }) {
  const [editing, setEditing] = useState(false);
  const template = entry.draft.template, definition = findPromptTemplate(template.id, template.version);
  const versions = promptTemplateCatalog.filter(candidate => candidate.id === template.id);
  if (!definition) return <p role="alert" className="prompt-error">This draft's template is no longer available.</p>;
  return <div className="prompt-template" aria-label="Prompt template (cannot be removed)" role="group">
    <div className="prompt-template-header">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Locked"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      <span className="eyebrow">Template</span>
      <select aria-label="Template" value={template.id} disabled={locked} onChange={event => update(draft => selectTemplate(draft, event.target.value))}>
        {promptTemplates(entry.target.operation).map(option => <option key={option.id} value={option.id}>{option.title}</option>)}
      </select>
      <select aria-label="Template version" value={template.version} disabled={locked || versions.length < 2}
        onChange={event => update(draft => selectTemplate(draft, template.id, Number(event.target.value)))}>
        {versions.map(version => <option key={version.version} value={version.version}>v{version.version}</option>)}
      </select>
      <span className="prompt-badge" data-operation={entry.target.operation}>{entry.target.operation}</span>
      {template.markdown !== undefined && <span className="prompt-badge" data-edited>markdown edited</span>}
      <button type="button" className="prompt-template-edit" disabled={locked} onClick={() => setEditing(true)}>Edit template</button>
    </div>
    {definition.parameters.length > 0 && <div className="prompt-template-options">
      {definition.parameters.map(parameter => <TemplateParameter key={parameter.key} parameter={parameter} value={template.options[parameter.key] ?? parameter.default}
        disabled={locked} onChange={value => update(draft => setTemplateOption(draft, parameter.key, value))} />)}
    </div>}
    {editing && <TemplateEditor template={template} instruction={instruction} referenceCount={referenceCount} onClose={() => setEditing(false)}
      onSave={markdown => update(draft => setTemplateMarkdown(draft, markdown))} />}
  </div>;
}

function TemplateParameter({ parameter, value, disabled, onChange }: { parameter: PromptTemplateParameter; value: string | number; disabled: boolean; onChange: (value: string | number) => void }) {
  if (parameter.kind === 'enum') return <label>{parameter.label}
    <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {parameter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>;
  return <label><span className="prompt-option-label">{parameter.label}<output>{value}{parameter.unit ? ` ${parameter.unit}` : ''}</output></span>
    <input type="range" min={parameter.min} max={parameter.max} step={parameter.step} value={value} disabled={disabled}
      onChange={event => onChange(Number(event.target.value))} /></label>;
}

function PromptBody({ coordinator, entryKey, entry, locked, revisions, carrying, placeholder }: { coordinator: PromptComposerCoordinator; entryKey: string;
  entry: PromptComposerEntry; locked: boolean; revisions: PromptRevisionSource; carrying: boolean; placeholder: string }) {
  const body = useRef<HTMLDivElement>(null), focusNext = useRef<{ blockId: string; offset: number }>(undefined);
  const update = (change: Parameters<PromptComposerCoordinator['updateDraft']>[1]) => coordinator.updateDraft(entryKey, change);
  const blocks = entry.draft.body;
  // Opening a prompt puts the caret at the end of its text, ready to type.
  useEffect(() => {
    const areas = body.current?.querySelectorAll<HTMLTextAreaElement>('textarea');
    const last = areas?.[areas.length - 1];
    if (last && !last.disabled) { last.focus(); last.setSelectionRange(last.value.length, last.value.length); }
  }, []);
  useLayoutEffect(() => {
    const next = focusNext.current; if (!next) return;
    focusNext.current = undefined;
    const area = body.current?.querySelector<HTMLTextAreaElement>(`[data-block-id="${next.blockId}"]`);
    area?.focus(); area?.setSelectionRange(next.offset, next.offset);
  });
  const dropCarried = (cursor?: { blockId: string; offset: number }) => {
    const carried = coordinator.store.getState().carried;
    if (!carried) return false;
    if (cursor) coordinator.setCursor(entryKey, cursor);
    coordinator.insertReference(carried.reference, entryKey);
    coordinator.carry();
    return true;
  };
  return <div ref={body} className="prompt-body" aria-label="Prompt body" data-drop-target={carrying && !locked}
    onClick={event => { if (event.target === event.currentTarget && dropCarried()) event.preventDefault(); }}>
    {blocks.map((block, index) => block.kind === 'reference'
      ? <ReferenceChip key={block.id} reference={block.reference} revisions={revisions} onRemove={locked ? undefined : () => {
          const previous = blocks[index - 1];
          if (previous?.kind === 'text') focusNext.current = { blockId: previous.id, offset: previous.text.length };
          update(draft => removeBlock(draft, block.id));
        }} />
      : <PromptText key={block.id} block={block} disabled={locked} placeholder={index === 0 && blocks.length === 1 ? placeholder : undefined}
          last={index === blocks.length - 1}
          onCursor={offset => { coordinator.setCursor(entryKey, { blockId: block.id, offset }); }}
          onDrop={offset => dropCarried({ blockId: block.id, offset })}
          onChange={text => update(draft => setBlockText(draft, block.id, text))}
          onRemoveAdjacent={direction => {
            const neighbour = blocks[index + direction];
            if (neighbour?.kind !== 'reference') return false;
            // Removing a chip merges its neighbours; keep the caret where the user was typing.
            const before = direction < 0 ? blocks[index - 2] : block;
            if (before?.kind === 'text') focusNext.current = { blockId: before.id, offset: before.text.length };
            update(draft => removeBlock(draft, neighbour.id));
            return true;
          }}
          onPasteReferences={(references, offset) => {
            update(draft => references.reduceRight((next, reference) => insertReference(next, reference, { blockId: block.id, offset }), draft));
          }} />)}
  </div>;
}

function PromptText({ block, disabled, placeholder, last, onCursor, onDrop, onChange, onRemoveAdjacent, onPasteReferences }: {
  block: Extract<PromptBlock, { kind: 'text' }>; disabled: boolean; placeholder?: string; last: boolean; onCursor: (offset: number) => void;
  onDrop: (offset: number) => boolean; onChange: (text: string) => void; onRemoveAdjacent: (direction: -1 | 1) => boolean;
  onPasteReferences: (references: PromptReference[], offset: number) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = area.current; if (!element) return;
    // Text between references sizes to its content so chips flow inline with it; the last block fills the line.
    if (!last) {
      const style = getComputedStyle(element), context = measure.getContext('2d')!;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const widest = Math.max(0, ...(block.text || ' ').split('\n').map(line => context.measureText(line).width));
      element.style.width = `${Math.ceil(widest) + 14}px`;
    } else element.style.width = '';
    element.style.height = '0'; element.style.height = `${element.scrollHeight}px`;
  }, [block.text, last]);
  const cursor = () => onCursor(area.current?.selectionStart ?? block.text.length);
  return <textarea ref={area} data-block-id={block.id} className="prompt-body-text" data-last={last} rows={1} value={block.text}
    disabled={disabled} placeholder={placeholder} aria-label="Prompt text" maxLength={promptLimit}
    onChange={event => { onChange(event.target.value); onCursor(event.target.selectionStart); }}
    onSelect={cursor} onFocus={cursor}
    onClick={event => { if (onDrop(event.currentTarget.selectionStart)) event.preventDefault(); }}
    onKeyDown={event => {
      const { selectionStart, selectionEnd, value } = event.currentTarget;
      if (selectionStart !== selectionEnd) return;
      if (event.key === 'Backspace' && selectionStart === 0 && onRemoveAdjacent(-1)) event.preventDefault();
      if (event.key === 'Delete' && selectionStart === value.length && onRemoveAdjacent(1)) event.preventDefault();
    }}
    onPaste={event => {
      const references = pastedPromptReferences(event.clipboardData.getData('text/html'));
      if (!references?.length) return;
      event.preventDefault(); onPasteReferences(references, event.currentTarget.selectionStart);
    }} />;
}

function ReferenceIcon({ kind }: { kind: PromptReference['kind'] }) {
  return kind === 'diagram'
    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
    : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="8" height="7" rx="1" /><rect x="13" y="14" width="8" height="7" rx="1" /><path d="M7 10v4h6" /></svg>;
}
/** Shared reference presentation: whole diagrams are solid cyan, selected nodes dashed purple. */
export function ReferenceChip({ reference, revisions, onRemove, children }: { reference: PromptReference; revisions: PromptRevisionSource; onRemove?: () => void; children?: ReactNode }) {
  const tag = useRevisionTag(revisions)(reference.revisionId);
  const summary = referenceSummary(reference);
  return <span className="prompt-reference" data-kind={reference.kind}
    title={`${reference.kind === 'diagram' ? 'Whole diagram' : 'Selected nodes'} · ${summary} · pinned to ${tag}`}>
    <ReferenceIcon kind={reference.kind} /><span className="prompt-reference-label">{reference.label}</span>
    <small>{tag}{reference.kind === 'nodes' ? ` · ${reference.nodeIds.length || 'region'}${reference.nodeIds.length === 1 ? ' node' : reference.nodeIds.length ? ' nodes' : ''}` : ''}</small>
    {children}
    {onRemove && <button type="button" className="prompt-reference-remove" aria-label={`Remove reference ${summary}`} onClick={onRemove}>×</button>}
  </span>;
}

function CarriedGhost({ coordinator, reference, revisions }: { coordinator: PromptComposerCoordinator; reference: PromptReference; revisions: PromptRevisionSource }) {
  const [point, setPoint] = useState<{ x: number; y: number }>();
  useEffect(() => {
    const move = (event: PointerEvent) => setPoint({ x: event.clientX, y: event.clientY });
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); coordinator.carry(); } };
    window.addEventListener('pointermove', move); window.addEventListener('keydown', key, true);
    document.body.classList.add('is-placing-prompt-reference');
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('keydown', key, true); document.body.classList.remove('is-placing-prompt-reference'); };
  }, [coordinator]);
  return point ? createPortal(<div className="prompt-reference-ghost" aria-hidden="true" style={{ left: point.x + 14, top: point.y + 10 }}>
    <ReferenceChip reference={reference} revisions={revisions} /></div>, document.body) : null;
}

function RevisionRail({ id, coordinator, list }: { id: string; coordinator: PromptComposerCoordinator; list: PromptRevision[] }) {
  const carried = useStore(coordinator.store, state => state.carried);
  const names = useStore(revisionNames, state => state.names);
  return <aside id={id} className="prompt-revision-rail" aria-label="Diagram revisions">
    <header><span className="eyebrow">Revisions</span><small>{list.length}</small></header>
    {carried && <div className="prompt-carry-status" role="status">
      <span>Click the prompt box or the canvas to place {names[carried.reference.revisionId] ?? carried.reference.label}</span>
      <button type="button" onClick={() => coordinator.carry()}>Cancel</button>
    </div>}
    <ul>{list.map(revision => {
      const active = carried?.reference.revisionId === revision.id && carried.reference.kind === 'diagram';
      return <li key={revision.id} data-active={active}>
        <span className="prompt-revision-tag">r{revision.sequence}</span>
        <span className="prompt-revision-name"><span data-named={!!names[revision.id]}>{names[revision.id] ?? 'Untitled revision'}</span>
          <small>{revision.current ? 'current' : `${revision.ascii.split('\n').length} lines`}</small></span>
        <button type="button" aria-pressed={active} aria-label={`Pick up r${revision.sequence} to place in the prompt or on the canvas`}
          onClick={() => coordinator.carry(active ? undefined : revisionReference(revision))}>+</button>
      </li>;
    })}</ul>
  </aside>;
}

function RevisionsPane({ coordinator, entryKey, entry, revisions, list, onInserted }: { coordinator: PromptComposerCoordinator; entryKey: string;
  entry: PromptComposerEntry; revisions: PromptRevisionSource; list: PromptRevision[]; onInserted: () => void }) {
  const [selectedId, setSelectedId] = useState(list[0]?.id);
  const [renaming, setRenaming] = useState<string>();
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const names = useStore(revisionNames, state => state.names);
  const selected = list.find(revision => revision.id === selectedId) ?? list[0];
  const shown = list.filter(revision => !filter.trim() || `r${revision.sequence} ${names[revision.id] ?? ''} ${revision.id}`.toLowerCase().includes(filter.trim().toLowerCase()));
  if (!selected) return <p className="window-panel-message">This diagram has no recorded revisions.</p>;
  return <div className="prompt-revisions">
    <div className="prompt-revisions-list">
      <div className="diff-pane-toolbar">
        <input type="search" aria-label="Filter revisions" placeholder="Filter by name or ID" value={filter} onChange={event => setFilter(event.target.value)} />
      </div>
      <div role="listbox" aria-label="Diagram revisions" tabIndex={0} aria-activedescendant={`${entryKey}-${selected.id}`}
        onKeyDown={event => {
          const index = shown.findIndex(revision => revision.id === selected.id);
          const next = event.key === 'ArrowDown' ? shown[index + 1] : event.key === 'ArrowUp' ? shown[index - 1] : undefined;
          if (next) { event.preventDefault(); setSelectedId(next.id); setRenaming(undefined); }
        }}>
        {shown.map(revision => <div key={revision.id} id={`${entryKey}-${revision.id}`} role="option" aria-selected={revision.id === selected.id}
          onClick={() => { setSelectedId(revision.id); setRenaming(undefined); }}>
          <span className="prompt-revision-tag">r{revision.sequence}</span>
          <span className="prompt-revision-name"><span data-named={!!names[revision.id]}>{names[revision.id] ?? 'Untitled revision'}</span>
            <small>{revision.current ? 'current' : revision.id}</small></span>
        </div>)}
      </div>
    </div>
    <div className="prompt-revision-detail">
      <header>
        <span className="prompt-revision-tag">r{selected.sequence}</span>
        {renaming === selected.id
          ? <form className="prompt-rename" onSubmit={event => { event.preventDefault();
              renameRevision(selected.id, String(new FormData(event.currentTarget).get('name') ?? '')); setRenaming(undefined); }}>
              <input name="name" aria-label="Revision name" autoFocus maxLength={maxRevisionNameLength} defaultValue={names[selected.id] ?? ''}
                onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(undefined); } }} />
              <button type="submit" className="prompt-primary">Save name</button>
              <button type="button" onClick={() => setRenaming(undefined)}>Cancel</button>
            </form>
          : <><strong>{names[selected.id] ?? 'Untitled revision'}</strong>
              <button type="button" onClick={() => setRenaming(selected.id)} aria-label={`Rename r${selected.sequence}`}>Rename</button></>}
        <small>{selected.current ? 'Current revision' : selected.id}</small>
      </header>
      <pre className="prompt-revision-preview" aria-label={`Revision r${selected.sequence} preview`}>{selected.ascii}</pre>
      <footer>
        <button type="button" className="prompt-primary" disabled={composerUnsettled(entry)} onClick={() => {
          if (coordinator.insertReference(revisionReference(selected), entryKey)) { setMessage(''); onInserted(); }
        }}>Insert into prompt</button>
        <button type="button" onClick={() => void copyPromptReferences([revisionReference(selected)])
          .then(() => setMessage('Reference copied. Paste it into any prompt box.')).catch(error => setMessage(`Copy failed: ${String(error)}`))}>Copy as reference</button>
        <button type="button" onClick={() => coordinator.carry(revisionReference(selected))}>Place on canvas…</button>
        <ReferenceChip reference={revisionReference(selected)} revisions={revisions} />
      </footer>
      <p className="prompt-hint" role="status">{message || 'Names are stored separately, keyed by revision ID. Renaming never changes the revision.'}</p>
    </div>
  </div>;
}
