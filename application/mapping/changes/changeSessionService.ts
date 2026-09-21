import { patchDiagram } from '../../../domain/core/diagrams/patchDiagram';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { createHash, randomUUID } from 'node:crypto';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import type { CanvasSessionPort } from '../agent/ports';
import type { LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import type { DiagramChangeSessionRepository } from './ports';
import { summarizeChangeSession, type ChangeDocumentState, type ChangeSessionDocument, type DiagramChangeSession, type DiagramChange } from '../../../domain/mapping/changes/diagramChangeSession';
import { MappingDocumentController, type DiagramOperation } from '../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { mappingDocumentFromScene } from '../../../domain/mapping/workspace/mappingDocument';
import { sceneFromRevision, singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { connectionBox, validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';

export class ChangeSessionService {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private readonly repository: DiagramChangeSessionRepository,
    private readonly source: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>, private readonly bridge: CanvasSessionPort) {}
  private async projectId() { const p = await this.source.loadProject(); if (!p) throw new Error('Project is not initialized'); return p.id; }
  private serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.queues.set(id, next);
    void next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => {});
    return next;
  }
  async list() { return (await this.repository.list(await this.projectId())).filter(s => s.status !== 'archived')
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(summarizeChangeSession); }
  async get(id: string) { return this.repository.read(await this.projectId(), id); }
  async create(input: { title: string; description?: string; canvasId?: string; requestId: string }) {
    const projectId = await this.projectId();
    const id = `change-${createHash('sha256').update(`${projectId}:${input.requestId}`).digest('hex').slice(0,32)}`;
    return this.serialize(id, async () => {
      const signature = JSON.stringify(input);
      const prior = await this.repository.read(projectId, id).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (prior) {
        if (prior.receipts.create?.signature !== signature) throw new Error('REQUEST_ID_CONFLICT');
        return prior.receipts.create.result;
      }
      const documents = new Map<string, ChangeSessionDocument>();
      const catalog = await this.source.projectCatalogs.loadRepresentationCatalog(projectId);
      for (const rep of Object.values(catalog.representations).filter(r => r.status === 'settled')) {
        const revision = catalog.revisions[rep.currentRevisionId];
        const baseline = { document: mappingDocumentFromScene(sceneFromRevision(revision), revision.content?.kind === 'mapping-canvas' ? revision.content.edges ?? [] : []), canvas: initialCanvasState() };
        documents.set(rep.id, { id: rep.id, name: rep.name, representationId: rep.id, savedRevisionId: revision.id,
          baseline, proposed: structuredClone(baseline), version: 0, past: [], future: [] });
      }
      const live = this.bridge.list().filter(c => c.projectId === projectId && (!input.canvasId || c.canvasId === input.canvasId));
      if (input.canvasId && !live.length) throw new Error('Unknown project canvas');
      if (!input.canvasId && live.length > 1) throw new Error('Multiple live workspaces: specify canvasId to capture drafts');
      for (const canvas of live) for (const doc of canvas.documents) {
        const snapshot = await this.bridge.dispatch(canvas.canvasId, { method: 'snapshot', documentId: doc.documentId }) as LiveDocumentSnapshot;
        const baseline = structuredClone({ document: snapshot.document, canvas: snapshot.canvas });
        const key = snapshot.representationId ?? doc.representationId ?? doc.documentId;
        documents.set(key, { id: key, name: snapshot.name, representationId: snapshot.representationId ?? doc.representationId,
          savedRevisionId: snapshot.revisionId, capturedVersion: snapshot.version, baseline, proposed: structuredClone(baseline), version: 0, past: [], future: [] });
      }
      const result = { changeSessionId: id, canvasId: id, version: 0, documents: [...documents.values()].map(d => ({ documentId: d.id, name: d.name })) };
      const now = new Date().toISOString();
      await this.repository.write({ schemaVersion: 1, id, projectId, title: input.title, description: input.description ?? '', status: 'draft', version: 0,
        createdAt: now, updatedAt: now, documents: [...documents.values()], changes: [], receipts: { create: { signature, result } } });
      return result;
    });
  }
  /** Replay a completed bound MCP mutation before consulting its now-stale version. */
  async request<T>(id: string, requestId: string, signature: string, execute: () => Promise<T>): Promise<T> {
    return this.serialize(`api:${id}`, async () => {
      const key = `api:${requestId}`, existing = (await this.get(id)).receipts[key];
      if (existing) { if (existing.signature !== signature) throw new Error('REQUEST_ID_CONFLICT'); return existing.result as T; }
      const result = await execute();
      await this.serialize(id, async () => {
        const session = await this.get(id);
        session.receipts[key] = { signature, result };
        await this.repository.write(session);
      });
      return result;
    });
  }
  async descriptor(id: string) { const s = await this.get(id); return [{ canvasId: s.id, projectId: s.projectId,
    documents: s.documents.map(d => ({ documentId: d.id, name: d.name, representationId: d.representationId })) }]; }
  private document(session: DiagramChangeSession, id: string) { const doc = session.documents.find(d => d.id === id); if (!doc) throw new Error('Unknown change-session document'); return doc; }
  async snapshot(id: string, documentId: string): Promise<LiveDocumentSnapshot> {
    const s = await this.get(id), doc = this.document(s, documentId);
    return { ...structuredClone(doc.proposed), name: doc.name, representationId: doc.representationId, revisionId: doc.savedRevisionId,
      version: doc.version, canUndo: !!doc.past.length, canRedo: !!doc.future.length } as LiveDocumentSnapshot;
  }
  private async mutate<T>(id: string, requestId: string, signature: string, fn: (s: DiagramChangeSession) => T) {
    return this.serialize(id, async () => {
      const s = await this.get(id), key = `request:${requestId}`, receipt = s.receipts[key];
      if (receipt) { if (receipt.signature !== signature) throw new Error('REQUEST_ID_CONFLICT'); return receipt.result as T; }
      if (s.status === 'archived') throw new Error('Change session is archived');
      if (Object.keys(s.receipts).length >= 2000) throw new Error('Change session request capacity reached');
      const result = fn(s);
      s.version++; s.updatedAt = new Date().toISOString(); s.receipts[key] = { signature, result };
      await this.repository.write(s);
      return result;
    });
  }
  async apply(id: string, documentId: string, version: number, operations: DiagramOperation[], requestId: string) {
    return this.mutate(id, requestId, JSON.stringify({ documentId, version, operations }), s => {
      const doc = this.document(s, documentId);
      const controller = new MappingDocumentController(doc.proposed.document, doc.proposed.canvas, doc.version);
      const origins = this.projectOrigins(doc.baseline ? doc.proposed : { ...doc.proposed, nodeOrigins: {} }, operations);
      const result = controller.transact(version, operations);
      this.record(doc, { ...controller.getSnapshot(), nodeOrigins: origins });
      this.refreshChanges(s); s.status = 'draft';
      return result;
    });
  }
  private projectOrigins(state: ChangeDocumentState, operations: DiagramOperation[]) {
    let origins = state.nodeOrigins ?? Object.fromEntries(Object.values(state.document.scene.contents)
      .flatMap(d => diagramContentNodes(d.content).map(n => [n.id, n.id])));
    const shadow = new MappingDocumentController(state.document, state.canvas);
    for (const operation of operations) {
      const before = shadow.getSnapshot().document.scene;
      shadow.transact(shadow.getSnapshot().version, [operation]);
      const after = shadow.getSnapshot().document.scene;
      const next: Record<string,string> = {};
      for (const diagram of Object.values(after.contents)) {
        const old = before.contents[diagram.id];
        const nodes = diagramContentNodes(diagram.content);
        if (old?.content.revisionId === diagram.content.revisionId) {
          for (const node of nodes) if (origins[node.id]) next[node.id] = origins[node.id];
        } else if (old && operation.method === 'patchDiagram') {
          const box = connectionBox(before, operation.nodeId);
          if (box?.kind === 'diagram' && box.contentId === diagram.id) for (const [prior, current] of patchDiagram(old, operation.start, operation.end, operation.patch).nodeIds) {
            if (origins[prior]) next[current] = origins[prior];
          }
        } else if (old?.content.ascii === diagram.content.ascii) {
          for (const node of nodes) {
            const prior = diagramContentNodes(old.content).find(n => n.line === node.line && n.startColumn === node.startColumn && n.label === node.label);
            if (prior && origins[prior.id]) next[node.id] = origins[prior.id];
          }
        }
      }
      origins = next;
    }
    return origins;
  }
  private record(doc: ChangeSessionDocument, after: ChangeDocumentState) {
    doc.past = [...doc.past.slice(-49), doc.proposed]; doc.future = [];
    doc.proposed = structuredClone({ document: after.document, canvas: after.canvas, nodeOrigins: after.nodeOrigins }); doc.version++;
  }
  async createDocument(id: string, name: string, requestId: string) {
    return this.mutate(id, requestId, JSON.stringify({ name }), s => {
      const documentId = `draft-${randomUUID()}`;
      s.documents.push({ id: documentId, name, baseline: null, proposed: { document: mappingDocumentFromScene(singleDiagramScene('[New diagram]')),
        canvas: initialCanvasState() }, version: 0, past: [], future: [] });
      this.refreshChanges(s); s.status = 'draft'; return { documentId };
    });
  }
  private refreshChanges(s: DiagramChangeSession) {
    const changes: DiagramChange[] = [];
    for (const doc of s.documents) {
      if (!doc.baseline) { changes.push({ id: `canvas:${doc.id}`, documentId: doc.id, title: doc.name, type: 3, reasons: [], dependsOn: [] }); continue; }
      const before = new MappingDocumentController(doc.baseline.document, doc.baseline.canvas).nodes();
      const after = new MappingDocumentController(doc.proposed.document, doc.proposed.canvas).nodes();
      const candidates = new Map([...before, ...after].filter(n => n.layout === 'grid' && n.kind === 'diagram').map(n => [n.id, n]));
      for (const [nodeId, node] of candidates) {
        const a = before.find(n => n.id === nodeId), b = after.find(n => n.id === nodeId);
        const contentChanged = JSON.stringify(a) !== JSON.stringify(b);
        const incident = (state: ChangeDocumentState) => state.document.edges.filter(e => e.source.displayNodeId === nodeId || e.target.displayNodeId === nodeId);
        if (!contentChanged && JSON.stringify(incident(doc.baseline)) === JSON.stringify(incident(doc.proposed))) continue;
        changes.push({ id: `diagram:${doc.id}:${nodeId}`, documentId: doc.id, nodeId,
          title: node.layout === 'grid' ? node.content?.ascii.split('\n')[0].trim().slice(0,200) || nodeId : nodeId,
          type: a ? 1 : 2, reasons: [], dependsOn: [] });
      }
    }
    s.changes = changes.map(change => {
      const previous = s.changes.find(c => c.id === change.id);
      return previous ? { ...change, title: previous.title, reasons: previous.reasons, dependsOn: previous.dependsOn,
        type: change.type === 1 && previous.type === 4 ? 4 : change.type } : change;
    });
  }
  async update(input: { changeSessionId: string; requestId: string; expectedVersion: number; title?: string; status?: 'draft'|'ready'|'archived';
    changes?: DiagramChange[]; action?: 'undo'|'redo'|'reset'; documentId?: string }) {
    return this.mutate(input.changeSessionId, input.requestId, JSON.stringify(input), s => {
      if (s.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT: reread change session');
      if (input.action) {
        if (!input.documentId) throw new Error('documentId is required');
        const doc = this.document(s, input.documentId);
        if (input.action === 'reset') { if (!doc.baseline) throw new Error('A new canvas has no baseline'); this.record(doc, doc.baseline); }
        else {
          const target = input.action === 'undo' ? doc.past.pop() : doc.future.pop();
          if (!target) throw new Error('No history available');
          (input.action === 'undo' ? doc.future : doc.past).push(doc.proposed); doc.proposed = target; doc.version++;
        }
        this.refreshChanges(s); s.status = 'draft';
      }
      if (input.title) s.title = input.title;
      if (input.changes) {
        if (input.changes.length !== s.changes.length || new Set(input.changes.map(c => c.id)).size !== s.changes.length) throw new Error('Annotate every generated change exactly once');
        for (const change of input.changes) {
          const previous = s.changes.find(c => c.id === change.id);
          if (!previous || previous.documentId !== change.documentId || previous.nodeId !== change.nodeId
            || !((previous.type === 1 || previous.type === 4) ? [1,4].includes(change.type) : previous.type === change.type)) throw new Error('Invalid change target or type');
        }
        s.changes = input.changes;
      }
      if (input.status === 'ready') this.validateReady(s);
      if (input.status) s.status = input.status;
      return { ...summarizeChangeSession(s), version: s.version + 1 };
    });
  }
  private validateReady(s: DiagramChangeSession) {
    if (!s.changes.length) throw new Error('Session has no changes');
    const visited = new Set<string>(), visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('Cyclic change dependency');
      if (visited.has(id)) return;
      const change = s.changes.find(c => c.id === id); if (!change) throw new Error('Unknown change dependency');
      visiting.add(id); change.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
    };
    s.changes.forEach(c => visit(c.id));
    for (const doc of s.documents) for (const edge of doc.proposed.document.edges) {
      validateConnectionAnchor(doc.proposed.document.scene, edge.source); validateConnectionAnchor(doc.proposed.document.scene, edge.target);
    }
    for (const change of s.changes.filter(c => c.type === 2)) {
      const doc = this.document(s, change.documentId);
      const connected = doc.proposed.document.edges.some(edge => edge.target.displayNodeId === change.nodeId
        && !!doc.baseline && !!connectionBox(doc.baseline.document.scene, edge.source.displayNodeId)
        && (doc.proposed.nodeOrigins ? !!doc.proposed.nodeOrigins[edge.source.contentNodeId]
          : Object.values(doc.baseline.document.scene.contents).some(d => diagramContentNodes(d.content).some(n => n.id === edge.source.contentNodeId))));
      if (!connected) throw new Error(`Added diagram needs an edge from an existing diagram: ${change.title}`);
    }
  }
}
