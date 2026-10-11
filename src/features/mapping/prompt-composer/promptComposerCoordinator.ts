import { createStore } from 'zustand/vanilla';
import type { CreateDiagramInput, DiagramEditRun, PromptReference } from '../../../../domain/mapping/agent/diagramEdit';
import type { PromptOperation } from '../../../../domain/mapping/agent/promptTemplates';
import type { DiagramEditClient } from './diagramEditClient';
import { createPromptDraft, insertReferenceWithCursor, serializePromptDraft, type PromptCursor, type PromptDraft } from './promptDraft';

/** The fixed destination: the diagram to revise, or the anchor new diagrams are created beside. */
export interface PromptComposerTarget { operation: PromptOperation; canvasId: string; documentId: string; nodeId: string; label: string }
export interface PromptComposerEntry {
  target: PromptComposerTarget;
  draft: PromptDraft;
  pending: boolean;
  /** The exact request sent; retries resend it unchanged. */
  request?: CreateDiagramInput;
  run?: DiagramEditRun;
  error?: string;
}
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
  open(target: PromptComposerTarget) {
    const key = composerKey(target);
    this.store.setState(state => ({ activeKey: key, entries: { ...state.entries,
      [key]: state.entries[key] ?? { target: { ...target }, draft: createPromptDraft(target.operation), pending: false } } }));
    return key;
  }
  show(key: string) { this.store.setState({ activeKey: key }); }
  close() {
    const key = this.store.getState().activeKey;
    this.store.setState({ carried: undefined });
    if (key && !composerUnsettled(this.entry(key))) this.dismiss(key);
    else this.store.setState({ activeKey: undefined });
  }
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
    this.patch(key, { run, error: undefined });
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
    this.patch(key, { pending: true, error: undefined, run: undefined, request: undefined });
    try {
      const { target, draft } = entry;
      const capture = await this.client.capture(target.canvasId, target.documentId, target.nodeId);
      if (this.stopped) return;
      const request: CreateDiagramInput = { ...capture, nodeId: target.nodeId, prompt, requestId: crypto.randomUUID(),
        template: structuredClone(draft.template), ...(references.length ? { references } : {}),
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
