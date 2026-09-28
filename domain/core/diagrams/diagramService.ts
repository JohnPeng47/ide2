import { CanvasHistory, type CanvasHistoryRecord, type ResolvedCanvasDocument } from './canvasHistory';
import { DiagramRevisionEditor, type DiagramEdit, type DiagramView, type PreparedDiagramEdit } from './diagramRevisionEditor';
import type { DiagramInput } from './diagram';
import { persistDiagramData, restoreDiagramData, type DiagramRecordStore } from './diagramPersistence';
import { prepareCanvasTransfer, prepareTransferNavigation, transferBoundary, type CanvasTransfer, type TransferInput, type PreparedCanvasTransfer, type TransferState } from './canvasTransfer';

export type { DiagramEdit, DiagramView, DiagramRevision, DiagramRevisionId, ContextId, PreparedDiagramEdit } from './diagramRevisionEditor';
export type { DiagramRecordStore } from './diagramPersistence';

/** Runtime handle. Neither it nor the service belongs in a saved canvas. */
export interface DiagramEditingContext { readonly contextId: string }
export interface DiagramContextState {
  checkpointId: string;
  document: import('./canvasHistory').CanvasDocument;
  view: unknown;
  canUndo: boolean;
  canRedo: boolean;
}

/** Canvas controllers coordinate edits; this boundary owns history and its storage. */
export interface DiagramService {
  prepareTransfer(context: DiagramEditingContext, input: TransferInput, destination?: DiagramEditingContext): PreparedCanvasTransfer;
  transferBoundary(context: DiagramEditingContext, transaction: CanvasTransfer, canvasId: string, redo?: boolean): boolean;
  prepareTransferNavigation(source: DiagramEditingContext, destination: DiagramEditingContext, transaction: CanvasTransfer, redo?: boolean): { source: TransferState; destination: TransferState; transaction: CanvasTransfer };
  openContext(document: ResolvedCanvasDocument, view: unknown, history?: CanvasHistoryRecord): DiagramEditingContext;
  state(context: DiagramEditingContext): DiagramContextState;
  resolve(context: DiagramEditingContext, diagramId: string): DiagramView;
  document(context: DiagramEditingContext): ResolvedCanvasDocument;
  append(context: DiagramEditingContext, document: ResolvedCanvasDocument, view: unknown, correspondence?: ReadonlyMap<string, string>): void;
  navigate(context: DiagramEditingContext, redo?: boolean): boolean;
  reset(context: DiagramEditingContext): void;
  /** Portable transport adapters; callers must not interpret diagram revision tables. */
  exportContext(context: DiagramEditingContext): CanvasHistoryRecord;
  persistenceChanges(context: DiagramEditingContext, since?: number): import("./canvasHistory").HistoryChanges;
  retireTransactions(context: DiagramEditingContext, ids: ReadonlySet<string>): void;
  forkContext(context: DiagramEditingContext, view: unknown): CanvasHistoryRecord;
  adopt(context: DiagramEditingContext, proposed: CanvasHistoryRecord): void;
  prepareCreate(input: DiagramInput): PreparedDiagramEdit;
  prepareEdit(document: ResolvedCanvasDocument, diagramId: string, edit: DiagramEdit): PreparedDiagramEdit;
  persist(value: unknown): Promise<unknown>;
  restore<T>(value: unknown): Promise<T>;
}

export class RevisionedDiagramService implements DiagramService {
  // Object handles isolate two viewers of the same persisted context, and allow GC on close.
  private readonly contexts = new WeakMap<DiagramEditingContext, CanvasHistory>();
  constructor(private readonly store?: DiagramRecordStore) {}

  openContext(document: ResolvedCanvasDocument, view: unknown, record?: CanvasHistoryRecord): DiagramEditingContext {
    const history = new CanvasHistory(document, view, record);
    const context = Object.freeze({ contextId: history.contextId });
    this.contexts.set(context, history);
    return context;
  }
  private history(context: DiagramEditingContext) {
    const history = this.contexts.get(context);
    if (!history) throw new Error('Unknown diagram editing context');
    return history;
  }
  state(context: DiagramEditingContext): DiagramContextState {
    const history = this.history(context), head = history.head;
    return { checkpointId: head.id, document: head.document, view: head.view, canUndo: history.canUndo, canRedo: history.canRedo };
  }
  resolve(context: DiagramEditingContext, diagramId: string) {
    const history = this.history(context);
    return history.diagrams.resolve(history.contextId, diagramId);
  }
  document(context: DiagramEditingContext) { return this.history(context).document(); }
  append(context: DiagramEditingContext, document: ResolvedCanvasDocument, view: unknown, correspondence?: ReadonlyMap<string, string>) {
    this.history(context).append(document, view, correspondence);
  }
  navigate(context: DiagramEditingContext, redo = false) {
    const linked = this.history(context).navigationTransactionId(redo);
    if (linked) throw Error('Use workspace undo/redo for a canvas transfer.');
    return !!this.history(context).navigate(redo);
  }
  prepareTransfer(context: DiagramEditingContext, input: TransferInput, destination?: DiagramEditingContext) {
    return prepareCanvasTransfer(this.history(context).export(), input, destination ? this.history(destination).export() : undefined);
  }
  transferBoundary(context: DiagramEditingContext, transaction: CanvasTransfer, canvasId: string, redo = false) {
    return transferBoundary({ headId: this.history(context).headId }, transaction, canvasId, redo);
  }
  prepareTransferNavigation(source: DiagramEditingContext, destination: DiagramEditingContext, transaction: CanvasTransfer, redo = false) {
    return prepareTransferNavigation(this.history(source).export(), this.history(destination).export(), transaction, redo);
  }
  reset(context: DiagramEditingContext) { this.history(context).reset(); }
  persistenceChanges(context: DiagramEditingContext, since?: number) { return this.history(context).persistenceChanges(since); }
  retireTransactions(context: DiagramEditingContext, ids: ReadonlySet<string>) { this.history(context).retireTransactions(ids); }
  exportContext(context: DiagramEditingContext) { return this.history(context).export(); }
  forkContext(context: DiagramEditingContext, view: unknown) { return this.history(context).fork(view); }
  adopt(context: DiagramEditingContext, proposed: CanvasHistoryRecord) { this.history(context).adopt(proposed); }
  prepareCreate(input: DiagramInput) { return new DiagramRevisionEditor({}, () => ({})).prepareCreate(input); }
  prepareEdit(document: ResolvedCanvasDocument, diagramId: string, edit: DiagramEdit) {
    // Staging observes earlier operations in the batch without changing a live context.
    const staged = new CanvasHistory(document, {});
    return staged.diagrams.prepareEdit(staged.contextId, diagramId, edit);
  }
  async persist(value: unknown) {
    if (!this.store) throw new Error('Diagram persistence is unavailable in this runtime');
    return persistDiagramData(value, this.store);
  }
  async restore<T>(value: unknown): Promise<T> {
    if (!this.store) throw new Error('Diagram persistence is unavailable in this runtime');
    return restoreDiagramData(value, this.store) as Promise<T>;
  }
}
