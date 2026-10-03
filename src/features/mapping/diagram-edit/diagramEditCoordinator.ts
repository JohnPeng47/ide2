import { createStore } from 'zustand/vanilla';
import type { DiagramEditRun, EditDiagramInput } from '../../../../domain/mapping/agent/diagramEdit';
import type { DiagramEditClient } from './diagramEditClient';

export interface DiagramEditTarget { canvasId: string; documentId: string; nodeId: string; label: string }
export interface DiagramEditEntry {
  target: DiagramEditTarget;
  prompt: string;
  pending: boolean;
  request?: EditDiagramInput;
  run?: DiagramEditRun;
  error?: string;
}
export const editTargetKey = (target: Pick<DiagramEditTarget, 'documentId' | 'nodeId'>) => JSON.stringify([target.documentId, target.nodeId]);
export const editUnsettled = (entry: DiagramEditEntry) => entry.pending || !!entry.request && (!entry.run
  || ['generating', 'applying', 'awaiting-acknowledgement'].includes(entry.run.status));

/** UI lifetime is independent of selection, panels and undo. Only the backend applies revisions. */
export class DiagramEditCoordinator {
  readonly store = createStore<{ entries: Record<string, DiagramEditEntry>; activeKey?: string }>(() => ({ entries: {} }));
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private polling = new Set<string>();
  private stopped = false;
  constructor(private readonly client: DiagramEditClient, private readonly pollMs = 750) {}
  private entry(key: string) { return this.store.getState().entries[key]; }
  private patch(key: string, patch: Partial<DiagramEditEntry>) {
    if (this.stopped || !this.entry(key)) return;
    this.store.setState(state => ({ entries: { ...state.entries, [key]: { ...state.entries[key], ...patch } } }));
  }
  open(target: DiagramEditTarget) {
    const key = editTargetKey(target);
    this.store.setState(state => ({ activeKey: key, entries: { ...state.entries,
      [key]: state.entries[key] ?? { target: { ...target }, prompt: '', pending: false } } }));
  }
  show(key: string) { this.store.setState({ activeKey: key }); }
  close() {
    const key = this.store.getState().activeKey;
    if (key && !editUnsettled(this.entry(key))) this.dismiss(key);
    else this.store.setState({ activeKey: undefined });
  }
  dismiss(key: string) {
    const entry = this.entry(key);
    if (!entry || editUnsettled(entry)) return;
    clearTimeout(this.timers.get(key)); this.timers.delete(key);
    this.store.setState(state => {
      const entries = { ...state.entries }; delete entries[key];
      return { entries, activeKey: state.activeKey === key ? undefined : state.activeKey };
    });
  }
  setPrompt(key: string, prompt: string) {
    if (!editUnsettled(this.entry(key))) this.patch(key, { prompt });
  }
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
    if (editUnsettled(entry) || !entry.prompt.trim() || this.stopped) return;
    this.patch(key, { pending: true, error: undefined, run: undefined, request: undefined });
    try {
      const capture = await this.client.capture(entry.target.canvasId, entry.target.documentId, entry.target.nodeId);
      if (this.stopped) return;
      const request: EditDiagramInput = { ...capture, nodeId: entry.target.nodeId, prompt: entry.prompt.trim(), requestId: crypto.randomUUID() };
      // Retain the exact request before sending: a lost response must never start a second generation.
      this.patch(key, { request });
      this.accept(key, await this.client.start(request));
    } catch (error) { this.patch(key, { error: String(error) }); }
    finally { this.patch(key, { pending: false }); }
  }
  async retry(key: string) {
    const entry = this.entry(key);
    if (entry.pending || this.stopped) return;
    if (!entry.request) return this.submit(key);
    if (entry.run && entry.run.status !== 'awaiting-acknowledgement') return this.refresh(key);
    this.patch(key, { pending: true, error: undefined });
    try { this.accept(key, await this.client.start(entry.request)); }
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
    if (entry.pending || entry.run?.status !== 'generating' || this.stopped) return;
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
