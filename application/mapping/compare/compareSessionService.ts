import { flattenGrid, resolveScene } from '../../../domain/core/diagrams/lineGrid';
import type { GridBox } from '../../../domain/core/diagrams/lineGrid';
import { revisionScope } from '../../../domain/core/diagrams/diagramRevisionReview';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../core/errors';
import { sha256 } from '../../../domain/core/sha256';
import { checkpointRevisionIds, documentFromHistory, validateCanvasHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { documentPrefix, recordHistory, type WorkspaceIndex } from '../../../domain/mapping/workspace/workspaceRecords';
import { deserializeWorkspace } from '../../../domain/mapping/workspace/mappingWorkspaceCodec';
import { initialCanvasState, type MappingCanvasState, type MappingDocumentSnapshot } from '../../../domain/mapping/workspace/mappingWorkspace';
import { createCompareSessionSchema, type CompareCandidate, type CompareCanvasCopy, type ComparePageSession, type CompareSource, type CompareSessionSummary, type CompareDiagramTarget, type CompareDiagramPaneSpec, type CreateCompareSession } from '../../../domain/mapping/compare/comparePageSession';
import type { MappingWorkspaceService } from '../workspace/workspaceService';
import type { GeneratedCanvasSource } from '../evals/generatedCanvasCatalog';

export interface CompareSessionRepository {
  list(projectId: string): Promise<CompareSessionSummary[]>;
  read(id: string): Promise<ComparePageSession | null>;
  create(session: ComparePageSession): Promise<ComparePageSession>;
  delete(id: string): Promise<void>;
}

export function diagramTargets(history: CanvasHistoryRecord, checkpointId = history.headId): CompareDiagramTarget[] {
  const { scene } = documentFromHistory(history, checkpointId);
  const visit = (box: GridBox): CompareDiagramTarget[] => box.kind === 'container' ? box.children.flatMap(visit) : [{
    diagramId: `grid:${box.id}`, revisionId: scene.contents[box.contentId].revisionId,
    name: scene.contents[box.contentId].content.ascii.split('\n').find(line => line.trim())?.slice(0, 200) || box.id
  }];
  return visit(scene.root);
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
  onDelete?: (id: string) => Promise<void>;
  constructor(private readonly workspace: Pick<MappingWorkspaceService, 'loadRecords'>, private readonly store: CompareSessionRepository,
    private readonly generated?: GeneratedCanvasSource,
    private readonly projects?: Pick<import('../../core/ports/diagramRepository').DiagramRepository, 'loadProject'>) {}
  private async workspaceState() {
    const { records } = await this.workspace.loadRecords('current');
    const index = records.workspace as WorkspaceIndex | undefined;
    if (!index) throw new ApplicationError('invalid-input', 'Open and save a Mapping canvas first.');
    return { records, index };
  }
  async candidates(): Promise<CompareCandidate[]> {
    const { records, index } = await this.workspaceState();
    const generated = await Promise.all((await this.generated?.list() ?? [])
      .map(record => this.generated!.read(record.id)));
    const generatedById = new Map(generated.flatMap(canvas => canvas ? [[canvas.id, canvas] as const] : []));
    const workspace: CompareCandidate[] = index.documentIds.flatMap(documentId => {
      const prefix = documentPrefix(documentId), metadata = records[prefix + 'metadata'] as MappingDocumentSnapshot;
      const provenance = generatedById.get(documentId)?.generated;
      if (metadata.hidden || metadata.type === 'generated' && !provenance) return [];
      const origin = provenance ? { generated: provenance } : {};
      const history = recordHistory(records, documentId);
      return [{ documentId, checkpointId: history.headId, name: provenance ? `${metadata.name} · Current saved canvas` : 'Current saved canvas', canvasName: metadata.name, diagrams: diagramTargets(history), ...origin },
        ...Object.values(history.canvasViews?.saved ?? {}).filter(view => !view.archivedAt && view.finalCheckpointId && (!view.generation || view.generation.status === 'finished')).map(view => ({
          documentId, viewId: view.id, checkpointId: view.finalCheckpointId!, name: view.name, canvasName: metadata.name,
          diagrams: diagramTargets(history, view.finalCheckpointId!), ...origin
        }))];
    });
    return [...workspace, ...generated.flatMap(canvas => canvas && !workspace.some(item => item.documentId === canvas.id && !item.viewId && item.checkpointId === canvas.history.headId) ? [{ documentId: canvas.id, checkpointId: canvas.history.headId, name: canvas.name,
      canvasName: canvas.generated.contextName, diagrams: diagramTargets(canvas.history), generated: canvas.generated }] : [])];
  }
  async list() {
    // Listing comparison metadata needs project identity, not every live canvas checkpoint.
    const projectId = this.projects ? (await this.projects.loadProject())?.id : (await this.workspaceState()).index.projectId;
    return projectId ? this.store.list(projectId) : [];
  }
  async read(id: string) {
    const session = await this.store.read(id);
    if (!session) throw new ApplicationError('invalid-input', 'Comparison session not found.');
    return session;
  }
  async delete(id: string) { await this.read(id); await this.store.delete(id); await this.onDelete?.(id); }
  async create(input: unknown): Promise<ComparePageSession> {
    const request = createCompareSessionSchema.parse(input), requestHash = sha256(JSON.stringify(request));
    const existing = await this.store.read(request.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ApplicationError('conflict', 'Request ID already used for another comparison.');
      return existing;
    }
    const captured = await this.capture(request.pairs.flatMap(pair => [pair.A, pair.B]));
    return this.createPinned(request, captured);
  }
  async capture(sources: CompareSource[]) {
    const { records, index } = await this.workspaceState();
    const copies = new Map<string, CompareCanvasCopy>(), histories = new Map<string, CanvasHistoryRecord>();
    const createdAt = new Date().toISOString();
    const catalog = new Map(await Promise.all(sources.map(async source =>
      [JSON.stringify({ documentId: source.documentId, ...(source.viewId ? { viewId: source.viewId } : {}), checkpointId: source.checkpointId }),
        await this.generated?.read(source.documentId, source.checkpointId)] as const)));
    const capture = ({ documentId, viewId, checkpointId }: CompareSource) => {
      const source = { documentId, ...(viewId ? { viewId } : {}), checkpointId };
      const key = JSON.stringify(source);
      const previous = copies.get(key); if (previous) return previous;
      const generated = catalog.get(key);
      if (generated && !source.viewId && generated.history.snapshots[source.checkpointId]) {
        const history = copyCompareHistory(generated.history, source.checkpointId);
        history.snapshots[source.checkpointId].view ??= initialCanvasState();
        const copy: CompareCanvasCopy = { id: randomUUID(), source, canvasName: generated.generated.contextName, history, generated: structuredClone(generated.generated),
          view: { id: randomUUID(), name: generated.name, createdAt, savedAt: createdAt,
            startCheckpointId: source.checkpointId, finalCheckpointId: source.checkpointId, checkpointIds: [source.checkpointId] } };
        copies.set(key, copy); return copy;
      }
      if (!index.documentIds.includes(source.documentId)) throw new ApplicationError('invalid-input', 'Unknown canvas.');
      const prefix = documentPrefix(source.documentId), metadata = records[prefix + 'metadata'] as MappingDocumentSnapshot;
      if (metadata.type === 'generated' && !generated) throw new ApplicationError('invalid-input', 'The generated snapshot is unavailable.');
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
      const copy: CompareCanvasCopy = { id: randomUUID(), source, canvasName: generated?.generated.contextName ?? metadata.name, history: copiedHistory,
        ...(generated ? { generated: structuredClone(generated.generated) } : {}),
        view: { id: randomUUID(), name: view?.name ?? metadata.name, createdAt, savedAt: createdAt,
          startCheckpointId: source.checkpointId, finalCheckpointId: source.checkpointId, checkpointIds: [source.checkpointId],
          ...(view?.generation ? { generation: structuredClone(view.generation) } : {}) } };
      copies.set(key, copy); return copy;
    };
    sources.forEach(capture);
    return { projectId: index.projectId, canvases: [...copies.values()] };
  }
  async createPinned(input: unknown, captured: { projectId: string; canvases: CompareCanvasCopy[] }): Promise<ComparePageSession> {
    const request = createCompareSessionSchema.parse(input), requestHash = sha256(JSON.stringify(request));
    const copies = new Map(captured.canvases.map(copy => [JSON.stringify(copy.source), structuredClone(copy)]));
    const capture = ({ documentId, viewId, checkpointId }: CompareSource) => {
      const copy = copies.get(JSON.stringify({ documentId, ...(viewId ? { viewId } : {}), checkpointId }));
      if (!copy) throw new ApplicationError('invalid-input', 'Comparison source was not captured.');
      return copy;
    };
    const createdAt = new Date().toISOString();
    const pane = (copy: CompareCanvasCopy) => {
      const canvas = copy.history.snapshots[copy.history.headId].view as MappingCanvasState;
      // Same default as Mapping's native camera (360, 100, 1), in persisted coordinates.
      return { canvasCopyId: copy.id, camera: { transform: structuredClone(canvas?.viewport ?? { offset: { x: 170, y: 36 }, scale: 1 }) } };
    };
    const compares = request.pairs.map(pair => {
      const A = capture(pair.A), B = capture(pair.B);
      if (pair.A.diagram && pair.B.diagram) {
        const diagramPane = (copy: CompareCanvasCopy, target: NonNullable<CreateCompareSession['pairs'][number]['A']['diagram']>): CompareDiagramPaneSpec => {
          const pinned = diagramTargets(copy.history).find(item => item.diagramId === target.diagramId);
          if (!pinned) throw new ApplicationError('invalid-input', `Unknown diagram: ${target.diagramId}`);
          if (pinned.revisionId !== target.revisionId) throw new ApplicationError('conflict', 'The selected diagram revision does not match this snapshot. Refresh the views.');
          if (target.ranges?.some(range => range.endLine > copy.history.diagramRevisions[target.revisionId].diagram.content.ascii.split('\n').length))
            throw new ApplicationError('invalid-input', 'Comparison slice is outside the diagram.');
          if (target.nodeRef) {
            try { revisionScope(copy.history.diagramRevisions[target.revisionId], target.nodeRef); }
            catch { throw new ApplicationError('invalid-input', 'The selected subtree does not exist in this revision.'); }
          }
          return { kind: 'diagram', canvasCopyId: copy.id, ...target };
        };
        return { id: randomUUID(), title: pair.title ?? `${A.view.name} / ${B.view.name}`, ...(pair.explanation ? { explanation: pair.explanation } : {}), A: diagramPane(A, pair.A.diagram), B: diagramPane(B, pair.B.diagram) };
      }
      const diagrams = (copy: CompareCanvasCopy) => {
        const document = documentFromHistory(copy.history);
        return flattenGrid(resolveScene(document.scene)).filter(box => box.box.kind === 'diagram' && box.contentId)
          .sort((a, b) => a.bounds.row - b.bounds.row || a.bounds.column - b.bounds.column || a.box.id.localeCompare(b.box.id))
          .map(box => ({ id: `grid:${box.box.id}`, title: document.scene.contents[box.contentId!].content.ascii.split('\n').find(line => line.trim())?.slice(0, 200) || 'Diagram' }));
      };
      const targetsA = diagrams(A), targetsB = diagrams(B);
      // A self-comparison is the manual smoke-test tour, with explicit identical targets.
      const focusPairs = pair.focusPairs ?? (A.id === B.id ? targetsA.slice(0, 3).map(target => ({ title: target.title, A: target.id, B: target.id })) : []);
      const camera = (copy: CompareCanvasCopy, target: string, title: string, targets: typeof targetsA) => {
        if (!targets.some(item => item.id === target)) throw new ApplicationError('invalid-input', `Unknown diagram focus: ${target}`);
        const cameras = copy.view.cameraViews ??= [];
        const existing = cameras.find(camera => camera.focus.type === 'DiagramFocused' && camera.focus.diagramId === target);
        if (existing) return existing.id;
        const id = randomUUID(); cameras.push({ id, title, focus: { type: 'DiagramFocused', diagramId: target } });
        copy.view.defaultCameraViewId ??= id;
        return id;
      };
      const points = focusPairs.map(point => ({ id: randomUUID(), title: point.title,
        A: camera(A, point.A, point.title, targetsA), B: camera(B, point.B, point.title, targetsB) }));
      return { id: randomUUID(), title: A.id === B.id ? A.view.name : `${A.view.name} / ${B.view.name}`, A: pane(A), B: pane(B), ...(points.length ? { points } : {}) };
    });
    return this.store.create({ schemaVersion: 1, id: request.requestId, projectId: captured.projectId, title: request.title,
      createdAt, requestHash, canvases: [...copies.values()], compares });
  }
}
