import type { AgentContextSnapshot } from '../../../../domain/core/agents/agentContext';
import { createStore } from 'zustand/vanilla';
import type { CreateDiagramInput, DiagramEditRun, PromptReference } from '../../../../domain/mapping/agent/diagramEdit';
import { defaultTemplateSelection, type PromptOperation } from '../../../../domain/mapping/agent/promptTemplates';
import type { DiagramEditClient } from './diagramEditClient';
import { createPromptDraft, insertReferenceWithCursor, removeBlock, serializePromptDraft, type PromptCursor, type PromptDraft } from './promptDraft';

/** The fixed destination: the diagram to revise, or the anchor new diagrams are created beside. */
export interface PromptComposerTarget { operation: PromptOperation; canvasId: string; documentId: string; nodeId: string; label: string; subtreeLabel?: string; subtree?: CreateDiagramInput['subtree']; sources?: CreateDiagramInput['sources']; origin?: CreateDiagramInput['origin'] }
export interface PromptComposerEntry {
  llmSessionId: string;
  agentContext?: AgentContextSnapshot;
  agentSessionId?: string;
  target: PromptComposerTarget;
  draft: PromptDraft;
  pending: boolean;
  /** Selection identity -> automatic reference block; manual references have no binding. */
  selectionReferences?: Record<string, string>;
  /** The exact request sent; retries resend it unchanged. */
  request?: CreateDiagramInput;
  run?: DiagramEditRun;
  error?: string;
}
/** An unavailable snapshot keeps its existing pinned chip until explicitly deselected. */
export interface SelectionReference { id: string; reference?: PromptReference }
/** A reference picked up from the revision list, waiting for a click in a prompt or on a canvas. */
export interface CarriedReference { reference: PromptReference }
export const composerKey = (target: Pick<PromptComposerTarget, 'operation' | 'documentId' | 'nodeId'>) =>
  JSON.stringify([target.operation, target.documentId, target.nodeId]);
export const composerUnsettled = (entry: PromptComposerEntry) => entry.pending || !!entry.request && (!entry.run
  || ['generating', 'applying', 'awaiting-acknowledgement'].includes(entry.run.status));

/** UI lifetime is independent of selection, panels and undo. Only the backend applies revisions. */
export class PromptComposerCoordinator {
  readonly store = createStore<{ entries: Record<string, PromptComposerEntry>; activeKey?: string; carried?: CarriedReference }>(() => ({ entries: {} }));
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private polling = new Set<string>();
  private cursors = new Map<string, PromptCursor>();
  private stopped = false;
  constructor(private readonly client: DiagramEditClient, private readonly pollMs = 750) {}
  private entry(key: string) { return this.store.getState().entries[key]; }
  private patch(key: string, patch: Partial<PromptComposerEntry>) {
    if (this.stopped || !this.entry(key)) return;
    this.store.setState(state => ({ entries: { ...state.entries, [key]: { ...state.entries[key], ...patch } } }));
  }
  open(target: PromptComposerTarget, fresh = false) {
    const key = fresh ? crypto.randomUUID() : composerKey(target);
    this.store.setState(state => ({ activeKey: key, entries: { ...state.entries,
      [key]: state.entries[key] ?? { llmSessionId: crypto.randomUUID(), target: { ...target }, draft: createPromptDraft(target.operation), pending: false } } }));
    return key;
  }
  setTarget(key: string, patch: Partial<PromptComposerTarget>) {
    const entry = this.entry(key); if (!entry || composerUnsettled(entry)) return;
    this.patch(key, { target: { ...entry.target, ...patch }, error: undefined,
      ...(patch.operation && patch.operation !== entry.target.operation ? { run: undefined, request: undefined,
        draft: { ...entry.draft, count: 1, template: defaultTemplateSelection(patch.operation) } } : {}) });
  }
  syncSelections(documentId: string, selections: readonly SelectionReference[], key = this.store.getState().activeKey) {
    const entry = key && this.entry(key);
    if (!key || !entry || entry.target.documentId !== documentId || composerUnsettled(entry)) return;
    const desired = new Map(selections.map(selection => [selection.id, selection.reference]));
    const bindings = { ...entry.selectionReferences };
    let draft = entry.draft, cursor = this.cursors.get(key), changed = false, error: string | undefined;
    for (const [selectionId, blockId] of Object.entries(bindings)) {
      const reference = desired.get(selectionId);
      const index = draft.body.findIndex(block => block.id === blockId);
      if (!desired.has(selectionId)) {
        if (index >= 0) {
          const before = draft.body[index - 1], after = draft.body[index + 1];
          if (cursor?.blockId === after?.id && before?.kind === 'text')
            cursor = { blockId: before.id, offset: before.text.length + cursor.offset };
          draft = removeBlock(draft, blockId);
        }
        delete bindings[selectionId]; changed = true;
      } else {
        const block = draft.body[index];
        // A user-removed automatic chip stays removed until the selection is removed and re-added.
        if (reference && block?.kind === 'reference' && JSON.stringify(block.reference) !== JSON.stringify(reference)) {
          draft = { ...draft, body: draft.body.map(current => current.id === blockId
            ? { ...block, reference: structuredClone(reference) } : current) };
          changed = true;
        }
      }
    }
    try {
      for (const [selectionId, reference] of desired) {
        if (bindings[selectionId] || !reference) continue;
        const inserted = insertReferenceWithCursor(draft, reference, cursor);
        const trailing = inserted.draft.body.findIndex(block => block.id === inserted.cursor.blockId);
        bindings[selectionId] = inserted.draft.body[trailing - 1].id;
        draft = inserted.draft; cursor = inserted.cursor; changed = true;
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    if (changed || error) {
      this.patch(key, { draft, selectionReferences: bindings, error });
      if (cursor) this.cursors.set(key, cursor);
    }
  }
  show(key: string) { this.store.setState({ activeKey: key }); }
  close() { this.store.setState({ carried: undefined, activeKey: undefined }); }
  dismiss(key: string) {
    const entry = this.entry(key);
    if (!entry || composerUnsettled(entry)) return;
    clearTimeout(this.timers.get(key)); this.timers.delete(key); this.cursors.delete(key);
    this.store.setState(state => {
      const entries = { ...state.entries }; delete entries[key];
      return { entries, activeKey: state.activeKey === key ? undefined : state.activeKey };
    });
  }
  /** Drafts lock while a request is unsettled, so a retry always matches what the user sees. */
  updateDraft(key: string, update: (draft: PromptDraft) => PromptDraft) {
    const entry = this.entry(key);
    if (!entry || composerUnsettled(entry)) return;
    try { this.patch(key, { draft: update(entry.draft), error: undefined }); }
    catch (error) { this.patch(key, { error: error instanceof Error ? error.message : String(error) }); }
  }
  setCursor(key: string, cursor: PromptCursor) { this.cursors.set(key, cursor); }
  /** Inserts into the active composer at its last cursor. Returns false when no composer can take it. */
  insertReference(reference: PromptReference, key = this.store.getState().activeKey) {
    const entry = key && this.entry(key);
    if (!key || !entry || composerUnsettled(entry)) return false;
    let cursor: PromptCursor | undefined;
    this.updateDraft(key, draft => {
      const inserted = insertReferenceWithCursor(draft, reference, this.cursors.get(key));
      cursor = inserted.cursor;
      return inserted.draft;
    });
    if (cursor) this.cursors.set(key, cursor);
    return !!cursor;
  }
  carry(reference?: PromptReference) { this.store.setState({ carried: reference && { reference: structuredClone(reference) } }); }
  private accept(key: string, run: DiagramEditRun) {
    this.patch(key, { run, error: undefined,
      ...(run.agentSessionId ? { agentSessionId: run.agentSessionId } : {}),
      ...(run.status === 'completed' && run.agentContext ? { agentContext: structuredClone(run.agentContext) } : {}) });
    this.schedule(key);
  }
  private schedule(key: string) {
    clearTimeout(this.timers.get(key)); this.timers.delete(key);
    if (this.stopped || !['generating', 'applying'].includes(this.entry(key)?.run?.status ?? '')) return;
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.refresh(key); }, this.pollMs));
  }
  async submit(key: string) {
    const entry = this.entry(key);
    if (!entry || composerUnsettled(entry) || this.stopped) return;
    const { prompt, references } = serializePromptDraft(entry.draft);
    if (!prompt) return;
    if (entry.target.operation === 'extend-diagram' && (!entry.target.sources?.length || !entry.target.origin)) {
      this.patch(key, { error: 'Select nodes, click the green circle, then click empty canvas to place the origin.' }); return;
    }
    if (entry.target.operation === 'edit-diagram' && !entry.target.subtree) {
      this.patch(key, { error: 'Select a tree node to choose the subtree to update.' }); return;
    }
    this.patch(key, { pending: true, error: undefined, run: undefined, request: undefined });
    try {
      const { target, draft } = entry;
      const capture = await this.client.capture(target.canvasId, target.documentId, target.nodeId);
      if (this.stopped) return;
      const request: CreateDiagramInput = { ...capture, llmSessionId: entry.llmSessionId,
        ...(entry.agentContext ? { agentContext: structuredClone(entry.agentContext) } : {}), nodeId: target.nodeId, prompt, requestId: crypto.randomUUID(),
        template: structuredClone(draft.template),
        ...(target.operation === 'edit-diagram' ? { subtree: target.subtree } : {}),
        ...(target.operation === 'extend-diagram' ? { origin: target.origin, sources: target.sources } : {}), ...(references.length ? { references } : {}),
        ...(target.operation === 'create-diagram' ? { count: draft.count } : {}) };
      // Retain the exact request before sending: a lost response must never start a second generation.
      this.patch(key, { request });
      this.accept(key, await this.client.start(request, target.operation));
    } catch (error) { this.patch(key, { error: String(error) }); }
    finally { this.patch(key, { pending: false }); }
  }
  async retry(key: string) {
    const entry = this.entry(key);
    if (!entry || entry.pending || this.stopped) return;
    if (!entry.request) return this.submit(key);
    if (entry.run && entry.run.status !== 'awaiting-acknowledgement') return this.refresh(key);
    this.patch(key, { pending: true, error: undefined });
    try { this.accept(key, await this.client.start(entry.request, entry.target.operation)); }
    catch (error) { this.patch(key, { error: String(error) }); }
    finally { this.patch(key, { pending: false }); }
  }
  async refresh(key: string) {
    const run = this.entry(key)?.run;
    if (!run || this.polling.has(key) || this.stopped) return;
    this.polling.add(key);
    try {
      const next = await this.client.status(run.runId);
      // A cancel/retry response may already have moved this run forward while the read was in flight.
      if (this.entry(key)?.run === run) this.accept(key, next);
    } catch (error) { if (this.entry(key)?.run === run) this.patch(key, { error: `Could not refresh progress: ${String(error)}` }); }
    finally {
      this.polling.delete(key);
      if (this.entry(key)?.run !== run && !this.timers.has(key)) this.schedule(key);
    }
  }
  async cancel(key: string) {
    const entry = this.entry(key);
    if (!entry || entry.pending || entry.run?.status !== 'generating' || this.stopped) return;
    this.patch(key, { pending: true });
    try { this.accept(key, await this.client.cancel(entry.run.runId)); }
    catch (error) { this.patch(key, { error: String(error) }); }
    finally { this.patch(key, { pending: false }); }
  }
  dispose() {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
