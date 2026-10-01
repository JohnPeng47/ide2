import type { CanvasHistoryService } from '../../../../domain/core/diagrams/canvasHistoryService';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { MappingDocumentController, type ControllerSnapshot } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { MappingGridDocument } from '../../../../domain/mapping/workspace/mappingGrid';
import type { MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import type { CanvasHistoryRecord } from '../../../../domain/core/diagrams/canvasHistory';
import { stateKey } from '../../../../domain/core/diagrams/canvasHistory';
import type { DiagramService } from '../../../../domain/core/diagrams/diagramService';

/** Consumers can select and subscribe; mutations stay behind session commands. */
export function readable<T>(store: StoreApi<T>): Pick<StoreApi<T>, 'getState' | 'getInitialState' | 'subscribe'> {
  return { getState: store.getState, getInitialState: store.getInitialState, subscribe: store.subscribe };
}

export interface SavedDocumentState { name: string; savedName: string; savedScene: string; savedEdges?: string }
export interface DocumentStatus { isDirty: boolean; sceneDirty: boolean; canUndo: boolean; canRedo: boolean }

/** Domain state remains owned by the controller. Stores publish immutable references,
 * never a second editable document. Pointer previews have no route to the controller. */
export class CanvasSession {
  readonly controller: MappingDocumentController;
  readonly document;
  private readonly documentState;
  readonly presentation;
  private readonly presentationState;
  readonly selection;
  private readonly selectionState;
  readonly controls;
  private readonly controlsState;
  readonly geometry;
  private readonly geometryState;
  readonly status;
  private readonly statusState;
  private baseline: SavedDocumentState;
  private savedSceneKey: string;
  private savedEdgesKey: string;
  private scene: MappingGridDocument['scene'];
  private edges: MappingGridDocument['edges'];
  private sceneKey: string;
  private edgesKey: string;
  private unsubscribe: () => void;
  private commitListeners = new Set<() => void>();

  constructor(input: SavedDocumentState & { document: MappingGridDocument; canvas: MappingCanvasState; history?: CanvasHistoryRecord }, diagrams?: DiagramService, history?: CanvasHistoryService) {
    this.baseline = { name: input.name, savedName: input.savedName, savedScene: input.savedScene, savedEdges: input.savedEdges };
    this.controller = new MappingDocumentController(input.document, input.canvas, 0, undefined, {}, input.history, diagrams, history);
    const snapshot = this.controller.getSnapshot();
    this.scene = snapshot.document.scene; this.edges = snapshot.document.edges;
    this.sceneKey = stateKey(this.scene); this.edgesKey = stateKey(this.edges);
    this.savedSceneKey = stateKey(JSON.parse(input.savedScene)); this.savedEdgesKey = stateKey(JSON.parse(input.savedEdges ?? '[]'));
    this.documentState = createStore(() => ({ document: snapshot.document }));
    this.presentationState = createStore(() => ({ display: snapshot.canvas.display, diagramViews: snapshot.canvas.diagramViews }));
    this.selectionState = createStore(() => snapshot.canvas.selection);
    this.controlsState = createStore(() => snapshot.canvas.controls);
    this.geometryState = createStore(() => this.geometryOf(snapshot));
    this.statusState = createStore(() => this.statusOf(snapshot));
    this.document = readable(this.documentState);
    this.presentation = readable(this.presentationState);
    this.selection = readable(this.selectionState);
    this.controls = readable(this.controlsState);
    this.geometry = readable(this.geometryState);
    this.status = readable(this.statusState);
    let previous = snapshot;
    this.unsubscribe = this.controller.subscribe(() => {
      const next = this.controller.getSnapshot();
      if (next.document.scene !== this.scene) { this.scene = next.document.scene; this.sceneKey = stateKey(this.scene); }
      if (next.document.edges !== this.edges) { this.edges = next.document.edges; this.edgesKey = stateKey(this.edges); }
      // Publish all controller changes synchronously; React observes one completed transaction.
      if (next.canvas.display !== previous.canvas.display || next.canvas.diagramViews !== previous.canvas.diagramViews)
        this.presentationState.setState({ display: next.canvas.display, diagramViews: next.canvas.diagramViews });
      if (next.canvas.selection !== previous.canvas.selection) this.selectionState.setState(next.canvas.selection, true);
      if (next.canvas.controls !== previous.canvas.controls) this.controlsState.setState(next.canvas.controls, true);
      if (next.endpointBounds !== previous.endpointBounds || next.cell !== previous.cell || next.version !== previous.version)
        this.geometryState.setState(this.geometryOf(next));
      this.publishStatus(next);
      if (next.document !== previous.document) this.documentState.setState({ document: next.document });
      const committed = next.canvasRevisionId !== previous.canvasRevisionId;
      previous = next;
      if (committed) this.commitListeners.forEach(listener => listener());
    });
  }
  private geometryOf(s: ControllerSnapshot) { return { endpointBounds: s.endpointBounds, cell: s.cell, version: s.version }; }
  private statusOf(s: ControllerSnapshot): DocumentStatus {
    const sceneDirty = this.sceneKey !== this.savedSceneKey;
    return { sceneDirty, isDirty: sceneDirty || this.edgesKey !== this.savedEdgesKey || this.baseline.name !== this.baseline.savedName,
      canUndo: s.canUndo, canRedo: s.canRedo };
  }
  private publishStatus(s = this.controller.getSnapshot()) {
    const next = this.statusOf(s), prior = this.status.getState();
    if (Object.keys(next).some(key => next[key as keyof DocumentStatus] !== prior[key as keyof DocumentStatus])) this.statusState.setState(next);
  }
  /** A save acknowledgement names the captured baseline, not whatever is current now. */
  updateBaseline(input: SavedDocumentState) {
    if (input.savedScene !== this.baseline.savedScene) this.savedSceneKey = stateKey(JSON.parse(input.savedScene));
    if (input.savedEdges !== this.baseline.savedEdges) this.savedEdgesKey = stateKey(JSON.parse(input.savedEdges ?? '[]'));
    this.baseline = { name: input.name, savedName: input.savedName, savedScene: input.savedScene, savedEdges: input.savedEdges };
    this.publishStatus();
  }
  onCommit(listener: () => void) { this.commitListeners.add(listener); return () => { this.commitListeners.delete(listener); }; }
  dispose() { this.unsubscribe(); this.commitListeners.clear(); }
}
