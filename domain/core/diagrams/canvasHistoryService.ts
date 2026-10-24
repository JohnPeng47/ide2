import { CanvasHistory, type CanvasHistoryRecord, type ResolvedCanvasDocument } from './canvasHistory';
import type { DiagramView } from './diagramRevisionEditor';
import { prepareCanvasTransfer, prepareTransferNavigation, transferBoundary, type CanvasTransfer, type TransferInput, type PreparedCanvasTransfer, type TransferState } from './canvasTransfer';


/** Runtime handle. Neither it nor the service belongs in a saved canvas. */
export interface CanvasEditingContext { readonly contextId: string }
export interface CanvasContextState {
  checkpointId: string;
  document: import('./canvasHistory').CanvasDocument;
  view: unknown;
  canUndo: boolean;
  canRedo: boolean;
}

/** Canvas controllers coordinate edits; this boundary owns history and its storage. */
export interface CanvasHistoryService {
  canvasViewComparison(context: CanvasEditingContext, viewId: string): import('./canvasView').CanvasViewComparison;
  canvasViews(context: CanvasEditingContext): import('./canvasView').CanvasViews;
  canvasView(context: CanvasEditingContext, input: import('./canvasView').CanvasViewCommand, view?: unknown): import('./canvasView').CanvasViews;
  navigation?(context: CanvasEditingContext): import('./canvasHistory').CanvasHistoryNavigation;
  prepareTransfer(context: CanvasEditingContext, input: TransferInput, destination?: CanvasEditingContext): PreparedCanvasTransfer;
  transferBoundary(context: CanvasEditingContext, transaction: CanvasTransfer, canvasId: string, redo?: boolean): boolean;
  prepareTransferNavigation(source: CanvasEditingContext, destination: CanvasEditingContext, transaction: CanvasTransfer, redo?: boolean): { source: TransferState; destination: TransferState; transaction: CanvasTransfer };
  openContext(document: ResolvedCanvasDocument, view: unknown, history?: CanvasHistoryRecord): CanvasEditingContext;
  state(context: CanvasEditingContext): CanvasContextState;
  resolve(context: CanvasEditingContext, diagramId: string): DiagramView;
  document(context: CanvasEditingContext): ResolvedCanvasDocument;
  append(context: CanvasEditingContext, document: ResolvedCanvasDocument, view: unknown, correspondence?: ReadonlyMap<string, string>): void;
  navigate(context: CanvasEditingContext, redo?: boolean): boolean;
  reset(context: CanvasEditingContext): void;
  /** Portable transport adapters; callers must not interpret diagram revision tables. */
  exportContext(context: CanvasEditingContext, currentOnly?: boolean): CanvasHistoryRecord;
  persistenceChanges(context: CanvasEditingContext, since?: number): import("./canvasHistory").HistoryChanges;
  retireTransactions(context: CanvasEditingContext, ids: ReadonlySet<string>): void;
  forkContext(context: CanvasEditingContext, view: unknown): CanvasHistoryRecord;
  adopt(context: CanvasEditingContext, proposed: CanvasHistoryRecord): void;
}

export class DefaultCanvasHistoryService implements CanvasHistoryService {
  canvasViewComparison(context: CanvasEditingContext, viewId: string) { return this.history(context).canvasViewComparison(viewId); }
  canvasViews(context: CanvasEditingContext) { return this.history(context).canvasViews(); }
  canvasView(context: CanvasEditingContext, input: import('./canvasView').CanvasViewCommand, view?: unknown) { return this.history(context).canvasView(input, view); }
  constructor(private readonly validation: import('./canvasHistory').HistoryValidation = 'all') {}
  // Object handles isolate two viewers of the same persisted context, and allow GC on close.
  private readonly contexts = new WeakMap<CanvasEditingContext, CanvasHistory>();

  openContext(document: ResolvedCanvasDocument, view: unknown, record?: CanvasHistoryRecord): CanvasEditingContext {
    const history = new CanvasHistory(document, view, record, this.validation);
    const context = Object.freeze({ contextId: history.contextId });
    this.contexts.set(context, history);
    return context;
  }
  private history(context: CanvasEditingContext) {
    const history = this.contexts.get(context);
    if (!history) throw new Error('Unknown diagram editing context');
    return history;
  }
  state(context: CanvasEditingContext): CanvasContextState {
    const history = this.history(context), head = history.head;
    return { checkpointId: head.id, document: head.document, view: head.view, canUndo: history.canUndo, canRedo: history.canRedo };
  }
  resolve(context: CanvasEditingContext, diagramId: string) {
    const history = this.history(context);
    return history.diagrams.resolve(history.contextId, diagramId);
  }
  document(context: CanvasEditingContext) { return this.history(context).document(); }
  append(context: CanvasEditingContext, document: ResolvedCanvasDocument, view: unknown, correspondence?: ReadonlyMap<string, string>) {
    this.history(context).append(document, view, correspondence);
  }
  navigate(context: CanvasEditingContext, redo = false) {
    const linked = this.history(context).navigationTransactionId(redo);
    if (linked) throw Error('Use workspace undo/redo for a canvas transfer.');
    return !!this.history(context).navigate(redo);
  }
  prepareTransfer(context: CanvasEditingContext, input: TransferInput, destination?: CanvasEditingContext) {
    return prepareCanvasTransfer(this.history(context).export(), input, destination ? this.history(destination).export() : undefined);
  }
  transferBoundary(context: CanvasEditingContext, transaction: CanvasTransfer, canvasId: string, redo = false) {
    return transferBoundary({ headId: this.history(context).headId }, transaction, canvasId, redo);
  }
  prepareTransferNavigation(source: CanvasEditingContext, destination: CanvasEditingContext, transaction: CanvasTransfer, redo = false) {
    return prepareTransferNavigation(this.history(source).export(), this.history(destination).export(), transaction, redo);
  }
  reset(context: CanvasEditingContext) { this.history(context).reset(); }
  persistenceChanges(context: CanvasEditingContext, since?: number) { return this.history(context).persistenceChanges(since); }
  retireTransactions(context: CanvasEditingContext, ids: ReadonlySet<string>) { this.history(context).retireTransactions(ids); }
  exportContext(context: CanvasEditingContext, currentOnly = false) { return this.history(context).export(currentOnly); }
  navigation(context: CanvasEditingContext) { return this.history(context).navigation(); }
  forkContext(context: CanvasEditingContext, view: unknown) { return this.history(context).fork(view); }
  adopt(context: CanvasEditingContext, proposed: CanvasHistoryRecord) { this.history(context).adopt(proposed); }
}
