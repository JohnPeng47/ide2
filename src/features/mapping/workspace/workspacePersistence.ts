import type { StorageChange } from '../../../../domain/core/storage/storageService';
import { documentPrefix, historyChanges, type WorkspaceIndex } from '../../../../domain/mapping/workspace/workspaceRecords';
import type { CanvasTransfer } from '../../../../domain/core/diagrams/canvasTransfer';
import type { StoredCanvasSnapshot } from '../../../../domain/core/diagrams/canvasHistory';
import type { CanvasDraft, CanvasWorkspace } from './canvasWorkspace';
import type { CanvasSession } from './canvasSession';
import type { SourcePaneViewState } from '../source-pane/sourcePaneViewState';
import type { RecordStorage } from './recordStorage';

/** Owns the translation from live owners to persisted records, never a global snapshot. */
export class WorkspacePersistence {
  private cursors = new WeakMap<CanvasSession, number>();
  private known = new Map<string, CanvasDraft>();
  private subscriptions: (() => void)[] = [];
  private activeDocumentId?: string;
  private transfers: CanvasTransfer[] = [];
  private paused = false;
  constructor(private readonly workspace: CanvasWorkspace, private readonly storage: RecordStorage,
    private readonly projectId: string, private readonly view: SourcePaneViewState) {
    const index = storage.get<WorkspaceIndex>('workspace');
    this.activeDocumentId = index?.activeDocumentId; this.transfers = index?.transfers ?? [];
    this.subscriptions.push(workspace.onPersist(ids => this.sync(ids)), view.subscribe(id => this.syncView(id)));
    this.sync([...new Set([...(index?.documentIds ?? []), ...Object.keys(workspace.store.getState().drafts)])]);
  }
  setPaused(paused: boolean) { this.paused = paused; }
  update(activeDocumentId: string | undefined, transfers: CanvasTransfer[]) {
    this.activeDocumentId = activeDocumentId; this.transfers = transfers;
    if (!this.paused) this.storage.batch([this.index()]);
  }
  private index(): StorageChange {
    const ids = Object.keys(this.workspace.store.getState().drafts);
    return { key: 'workspace', value: { projectId: this.projectId, documentIds: ids,
      activeDocumentId: this.activeDocumentId && ids.includes(this.activeDocumentId) ? this.activeDocumentId : ids[0], transfers: this.transfers } satisfies WorkspaceIndex };
  }
  sync(ids = [...new Set([...this.known.keys(), ...Object.keys(this.workspace.store.getState().drafts)])]) {
    if (this.paused) return;
    const drafts = this.workspace.store.getState().drafts, changes: StorageChange[] = [];
    for (const id of ids) {
      const draft = drafts[id], prior = this.known.get(id), prefix = documentPrefix(id);
      if (!draft) {
        for (const key of this.storage.keys()) if (key.startsWith(prefix)) changes.push({ key, delete: true });
        this.known.delete(id); continue;
      }
      const { representationId: savedRepresentationId, name, hidden, savedName, savedScene, savedEdges, revisionId } = draft;
      changes.push({ key: prefix + 'metadata', value: { representationId: id, savedRepresentationId, name, hidden } },
        { key: prefix + 'baseline', value: { savedName, savedScene, savedEdges, revisionId } });
      const cursor = this.cursors.get(draft.session), delta = draft.session.controller.persistenceChanges(cursor);
      if (cursor === undefined) {
        // Import/reset can replace a canvas's history graph under the same ID.
        // Remove the old graph in the same atomic batch as its replacement.
        const retained = new Set(historyChanges(id, delta).map(change => change.key));
        for (const key of this.storage.keys()) {
          if ((key.startsWith(prefix + 'revision/') || key.startsWith(prefix + 'checkpoint/')) && !retained.has(key)) changes.push({ key, delete: true });
        }
      }
      for (const change of historyChanges(id, delta)) {
        // A new runtime session may attach to history already present in storage.
        // Revision IDs are immutable; checkpoints may have retired transfer links.
        if (cursor === undefined && 'value' in change && this.storage.get(change.key)) {
          if (change.key.startsWith(prefix + 'revision/')) continue;
          if (change.key.startsWith(prefix + 'checkpoint/') && this.storage.get<StoredCanvasSnapshot>(change.key)?.transactionId === (change.value as StoredCanvasSnapshot).transactionId) continue;
        }
        changes.push(change);
      }
      this.cursors.set(draft.session, delta.sequence);
      const canvas = draft.session.controller.getSnapshot().canvas;
      changes.push({ key: prefix + 'canvas', value: { ...canvas, display: this.view.captureDisplay(id, canvas.display) } });
      if (prior?.viewport !== draft.viewport || !prior) {
        const viewport = this.view.captureCamera(id, draft.viewport);
        if (viewport) changes.push({ key: prefix + 'viewport', value: viewport });
      }
      this.known.set(id, draft);
    }
    changes.push(this.index()); this.storage.batch(changes);
  }
  private syncView(id: string) {
    if (this.paused) return;
    const draft = this.workspace.store.getState().drafts[id]; if (!draft) return;
    const prefix = documentPrefix(id), canvas = draft.session.controller.getSnapshot().canvas;
    const viewport = this.view.captureCamera(id, draft.viewport);
    this.storage.batch([{ key: prefix + 'canvas', value: { ...canvas, display: this.view.captureDisplay(id, canvas.display) } },
      ...(viewport ? [{ key: prefix + 'viewport', value: viewport }] : [])]);
  }
  dispose() { this.subscriptions.forEach(off => off()); }
}
