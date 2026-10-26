import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../core/errors';
import { sha256 } from '../../../domain/core/sha256';
import { checkpointRevisionIds, documentFromHistory, validateCanvasHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { documentPrefix, recordHistory, type WorkspaceIndex } from '../../../domain/mapping/workspace/workspaceRecords';
import { deserializeWorkspace } from '../../../domain/mapping/workspace/mappingWorkspaceCodec';
import { initialCanvasState, type MappingCanvasState, type MappingDocumentSnapshot } from '../../../domain/mapping/workspace/mappingWorkspace';
import { createCompareSessionSchema, type CompareCandidate, type CompareCanvasCopy, type ComparePageSession, type CompareSource, type CompareSessionSummary } from '../../../domain/mapping/compare/comparePageSession';
import type { MappingWorkspaceService } from '../workspace/workspaceService';

export interface CompareSessionRepository {
  list(projectId: string): Promise<CompareSessionSummary[]>;
  read(id: string): Promise<ComparePageSession | null>;
  create(session: ComparePageSession): Promise<ComparePageSession>;
}

/** Capture only the selected endpoint and its rendering dependencies, never the undo archive. */
export function copyCompareHistory(history: CanvasHistoryRecord, checkpointId: string): CanvasHistoryRecord {
  const checkpoint = history.snapshots[checkpointId];
  if (!checkpoint) throw new ApplicationError('conflict', 'The selected checkpoint is no longer available. Refresh the views.');
  const { parentId: _parent, transactionId: _transaction, ...head } = checkpoint;
  const revisions = Object.fromEntries(checkpointRevisionIds(checkpoint).map(id => [id, history.diagramRevisions[id]]));
  const copy: CanvasHistoryRecord = structuredClone({ schemaVersion: 1, contextId: randomUUID(),
    baselineId: checkpointId, headId: checkpointId, past: [], future: [], snapshots: { [checkpointId]: head }, diagramRevisions: revisions,
    revisionBoundary: Object.fromEntries(Object.values(revisions).flatMap(revision => revision?.parentId && !revisions[revision.parentId] ? [[revision.parentId, revision.diagramId]] : [])) });
  validateCanvasHistory(copy);
  return copy;
}

export class CompareSessionService {
  constructor(private readonly workspace: Pick<MappingWorkspaceService, 'loadRecords'>, private readonly store: CompareSessionRepository) {}
  private async workspaceState() {
    const { records } = await this.workspace.loadRecords('current');
    const index = records.workspace as WorkspaceIndex | undefined;
    if (!index) throw new ApplicationError('invalid-input', 'Open and save a Mapping canvas first.');
    return { records, index };
  }
  async candidates(): Promise<CompareCandidate[]> {
    const { records, index } = await this.workspaceState();
    return index.documentIds.flatMap(documentId => {
      const prefix = documentPrefix(documentId), metadata = records[prefix + 'metadata'] as MappingDocumentSnapshot;
      if (metadata.hidden) return [];
      const history = records[prefix + 'history'] as CanvasHistoryRecord;
      return [{ documentId, checkpointId: history.headId, name: 'Current saved canvas', canvasName: metadata.name },
        ...Object.values(history.canvasViews?.saved ?? {}).filter(view => !view.archivedAt && view.finalCheckpointId).map(view => ({
          documentId, viewId: view.id, checkpointId: view.finalCheckpointId!, name: view.name, canvasName: metadata.name
        }))];
    });
  }
  async list() { const { index } = await this.workspaceState(); return this.store.list(index.projectId); }
  async read(id: string) {
    const session = await this.store.read(id);
    if (!session) throw new ApplicationError('invalid-input', 'Comparison session not found.');
    return session;
  }
  async create(input: unknown): Promise<ComparePageSession> {
    const request = createCompareSessionSchema.parse(input), requestHash = sha256(JSON.stringify(request));
    const existing = await this.store.read(request.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ApplicationError('conflict', 'Request ID already used for another comparison.');
      return existing;
    }
    const { records, index } = await this.workspaceState();
    const copies = new Map<string, CompareCanvasCopy>(), histories = new Map<string, CanvasHistoryRecord>();
    const createdAt = new Date().toISOString();
    const capture = (source: CompareSource) => {
      const key = JSON.stringify(source);
      const previous = copies.get(key); if (previous) return previous;
      if (!index.documentIds.includes(source.documentId)) throw new ApplicationError('invalid-input', 'Unknown canvas.');
      const prefix = documentPrefix(source.documentId), metadata = records[prefix + 'metadata'] as MappingDocumentSnapshot;
      let history = histories.get(source.documentId);
      if (!history) { history = recordHistory(records, source.documentId); histories.set(source.documentId, history); }
      const view = source.viewId ? history.canvasViews?.saved[source.viewId] : undefined;
      if (source.viewId && (!view || view.archivedAt || view.finalCheckpointId !== source.checkpointId)
        || !source.viewId && history.headId !== source.checkpointId)
        throw new ApplicationError('conflict', 'The selected view changed. Refresh the views and try again.');
      const copiedHistory = copyCompareHistory(history, source.checkpointId);
      const checkpoint = copiedHistory.snapshots[source.checkpointId];
      const canvas = (checkpoint.view ?? initialCanvasState()) as MappingCanvasState;
      if (!source.viewId && records[prefix + 'viewport']) canvas.viewport = structuredClone(records[prefix + 'viewport']) as MappingCanvasState['viewport'];
      checkpoint.view = canvas;
      // Resolve and validate presentation data before publishing a session.
      const document = documentFromHistory(copiedHistory);
      deserializeWorkspace({ schemaVersion: 3, projectId: index.projectId, documents: [{
        representationId: source.documentId, name: metadata.name, revisionId: 'compare-snapshot', savedName: metadata.name,
        savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), document, canvas
      }] });
      const copy: CompareCanvasCopy = { id: randomUUID(), source, canvasName: metadata.name, history: copiedHistory,
        view: { id: randomUUID(), name: view?.name ?? metadata.name, createdAt, savedAt: createdAt,
          startCheckpointId: source.checkpointId, finalCheckpointId: source.checkpointId, checkpointIds: [source.checkpointId],
          ...(view?.generation ? { generation: structuredClone(view.generation) } : {}) } };
      copies.set(key, copy); return copy;
    };
    const pane = (copy: CompareCanvasCopy) => {
      const canvas = copy.history.snapshots[copy.history.headId].view as MappingCanvasState;
      // Same default as Mapping's native camera (360, 100, 1), in persisted coordinates.
      return { canvasCopyId: copy.id, camera: { transform: structuredClone(canvas?.viewport ?? { offset: { x: 170, y: 36 }, scale: 1 }) } };
    };
    const compares = request.pairs.map(pair => {
      if (JSON.stringify(pair.A) === JSON.stringify(pair.B)) throw new ApplicationError('invalid-input', 'Choose two different views.');
      const A = capture(pair.A), B = capture(pair.B);
      return { id: randomUUID(), title: `${A.view.name} / ${B.view.name}`, A: pane(A), B: pane(B) };
    });
    return this.store.create({ schemaVersion: 1, id: request.requestId, projectId: index.projectId, title: request.title,
      createdAt, requestHash, canvases: [...copies.values()], compares });
  }
}
