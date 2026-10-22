import { buildChangeTreemaps } from '../../../domain/mapping/changes/changeTreemap';
import { defaultDiffTree, diffTreeSummary, diffTreeNodes, resolveDiffTreeHunks, validateDiffTree, writeDiffTree, type DiffTreeInput } from '../../../domain/mapping/changes/diffTree';
import type { RepositoryContext } from '../../../domain/core/repositories/repository';
import type { GitDiffHunk } from '../../../domain/core/diffs/gitDiffHunk';
import { migrationIssues, type DiagramMigration } from '../../../domain/mapping/changes/diagramMigration';
import { canvasDisplayNodes } from '../../../domain/mapping/workspace/canvasDisplayNode';
import { DefaultCanvasHistoryService } from '../../../domain/core/diagrams/canvasHistoryService';
import { RevisionedDiagramService, type DiagramService } from '../../../domain/core/diagrams/diagramService';
import { historyFromRevision, documentFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { createHash, randomUUID } from 'node:crypto';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import type { CanvasSessionPort } from '../agent/ports';
import type { LiveDocumentSnapshot, LiveDocumentState } from '../../../domain/mapping/agent/contracts';
import type { DiagramChangeSessionRepository } from './ports';
import { summarizeChangeSession, type ChangeDocumentState, type ChangeSessionDocument, type DiagramChangeSession, type DiagramChange } from '../../../domain/mapping/changes/diagramChangeSession';
import { MappingDocumentController, type DiagramOperation } from '../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { mappingDocumentFromScene } from '../../../domain/mapping/workspace/mappingDocument';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { connectionBox, validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { stateKey } from '../../../domain/core/diagrams/canvasHistory';
import type { ChangeSessionAcceptance } from '../../../domain/core/representations/changeAcceptance';

export interface ChangeSessionCapture {
  projectId: string;
  context?: RepositoryContext;
  hunks: GitDiffHunk[];
  documents: ChangeSessionDocument[];
  baselineChangeSessionId?: string;
}

export class ChangeSessionService {
  private readonly historyService = new DefaultCanvasHistoryService();
  private queues = new Map<string, Promise<unknown>>();
  constructor(private readonly repository: DiagramChangeSessionRepository,
    private readonly source: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs' | 'repositories'>, private readonly bridge: CanvasSessionPort, private readonly diagrams: DiagramService = new RevisionedDiagramService()) {}
  private async projectId() { const p = await this.source.loadProject(); if (!p) throw new Error('Project is not initialized'); return p.id; }
  private serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.queues.set(id, next);
    void next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => {});
    return next;
  }
  async list() {
    const projectId = await this.projectId(), sessions = await this.repository.listSummaries(projectId);
    const accepted = sessions.some(s => s.status === 'ready')
      ? await this.source.projectCatalogs.loadChangeSessionAcceptances(projectId) : undefined;
    // The catalog receipt is authoritative after an interrupted session write. Listing
    // projects that status; opening/accepting the proposal repairs the full record.
    for (const session of sessions) if (session.status === 'ready' && accepted?.[session.id]) {
      const receipt = accepted[session.id];
      if (session.version !== receipt.sessionVersion) throw new Error('Acceptance does not match saved proposal version');
      session.status = 'accepted'; session.acceptance = receipt;
      session.version = receipt.sessionVersion + 1; session.updatedAt = receipt.acceptedAt;
    }
    return sessions.filter(s => s.status !== 'archived').sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id: string) {
    const session = await this.repository.read(await this.projectId(), id);
    if (session.status === 'ready') {
      const accepted = (await this.source.projectCatalogs.loadChangeSessionAcceptances(session.projectId))[id];
      if (accepted) await this.finishAcceptance(session, accepted);
    }
    return session;
  }
  private async effectiveSummary(summary: import('../../../domain/mapping/changes/diagramChangeSession').ChangeSessionSummary) {
    if (summary.status === 'ready') {
      const receipt = (await this.source.projectCatalogs.loadChangeSessionAcceptances(summary.projectId))[summary.id];
      if (receipt) {
        if (summary.version !== receipt.sessionVersion) throw Error('Acceptance does not match saved proposal version');
        return { ...summary, status: 'accepted' as const, acceptance: receipt, version: receipt.sessionVersion + 1, updatedAt: receipt.acceptedAt };
      }
    }
    return summary;
  }
  async preview(id: string, documentId: string, version?: number) {
    const projectId = await this.projectId();
    const summary = await this.effectiveSummary(await this.repository.readSummary(projectId, id));
    if (!summary.documents.some(doc => doc.id === documentId)) throw Error('Unknown change-session document');
    if (summary.version === version) return null;
    const preview = await this.repository.readPreview(projectId, id, documentId);
    // Resolve acceptance against the exact generation returned by the scoped read.
    return { ...preview, ...await this.effectiveSummary(preview), document: preview.document };
  }
  /** Read one coherent generation without loading histories, receipts, or live Git files. */
  async readTreemaps(id: string, version?: number) {
    const projectId = await this.projectId();
    const summary = await this.effectiveSummary(await this.repository.readSummary(projectId, id));
    if (summary.version === version) return null;
    const stored = this.repository.readDiffTree ? await this.repository.readDiffTree(projectId, id)
      : await this.get(id).then(session => ({ summary: summarizeChangeSession(session), diffTree: session.diffTree }));
    const captured = await this.effectiveSummary(stored.summary);
    const documents: import('../../../domain/mapping/changes/diagramChangeSession').ChangePreviewDocument[] = [];
    for (let offset = 0; offset < captured.documents.length; offset += 4) {
      const previews = await Promise.all(captured.documents.slice(offset, offset + 4).map(doc => this.repository.readPreview(projectId, id, doc.id)));
      for (const preview of previews) {
        if ((await this.effectiveSummary(preview)).version !== captured.version) throw Error('VERSION_CONFLICT: changes updated while loading treemaps; retry');
        documents.push(preview.document);
      }
    }
    if ((await this.effectiveSummary(await this.repository.readSummary(projectId, id))).version !== captured.version)
      throw Error('VERSION_CONFLICT: changes updated while loading treemaps; retry');
    return { id, title: captured.title, version: captured.version, status: captured.status, head: captured.head,
      commits: captured.commits ?? [], hunks: stored.diffTree?.hunks ?? [], ...buildChangeTreemaps(stored.diffTree, documents) };
  }
  async discoverHunks(input: { repositoryId?: string; commits?: string[]; head?: string; comparisonBase?: string | null; offset: number; limit: number; includePatches: boolean }) {
    await this.projectId();
    if (!this.source.repositories) throw Error('Repository registry unavailable');
    const context = await this.source.repositories.resolveContext(input);
    const hunks = await this.captureHunks(context);
    return { ...context, ...this.hunkPage(hunks, input) };
  }
  private async captureHunks(context: RepositoryContext): Promise<GitDiffHunk[]> {
    if (!context.commits.length && context.comparisonBase === undefined) return [];
    if (!this.source.repositories?.captureHunks) throw Error('Git hunk capture unavailable');
    return this.source.repositories.captureHunks(context);
  }
  private hunkPage(hunks: GitDiffHunk[], input: { offset: number; limit: number; includePatches: boolean }) {
    return { total: hunks.length, offset: input.offset, nextOffset: input.offset + input.limit < hunks.length ? input.offset + input.limit : null,
      hunks: hunks.slice(input.offset, input.offset + input.limit).map(hunk => {
        if (input.includePatches) return hunk;
        const { patch: _, ...metadata } = hunk; return metadata;
      }) };
  }
  async readDiffTree(input: { changeSessionId: string; nodeIds?: string[]; hunkIds?: string[]; offset: number; limit: number; includePatches: boolean }) {
    const stored = this.repository.readDiffTree
      ? await this.repository.readDiffTree(await this.projectId(), input.changeSessionId)
      : await this.get(input.changeSessionId).then(session => ({ summary: summarizeChangeSession(session), diffTree: session.diffTree }));
    const summary = await this.effectiveSummary(stored.summary), tree = stored.diffTree;
    const context = { changeSessionId: summary.id, title: summary.title, version: summary.version, status: summary.status,
      repositoryId: summary.repositoryId, commits: summary.commits, head: summary.head, comparisonBase: summary.comparisonBase, documents: summary.documents, changes: summary.changes };
    if (!tree) return { ...context, diffTree: null, ...this.hunkPage([], input), unmappedNodeIds: [] };
    const selection = input.nodeIds ? resolveDiffTreeHunks(tree, input.nodeIds) : undefined;
    const ids = input.hunkIds ?? selection?.hunkIds;
    if (ids?.some(id => !tree.hunks.some(hunk => hunk.id === id))) throw Error('Unknown DiffTree hunk');
    const hunks = ids ? tree.hunks.filter(hunk => ids.includes(hunk.id)) : tree.hunks;
    return { ...context, diffTree: { ...diffTreeSummary(tree), diagram: tree.revision.diagram,
      nodes: diffTreeNodes(tree), mappings: tree.mappings }, ...this.hunkPage(hunks, input), unmappedNodeIds: selection?.unmappedNodeIds ?? [] };
  }
  private async finishAcceptance(session: DiagramChangeSession, acceptance: ChangeSessionAcceptance) {
    if (session.version !== acceptance.sessionVersion) throw new Error('Acceptance does not match saved proposal version');
    session.status = 'accepted'; session.acceptance = acceptance;
    session.version = acceptance.sessionVersion + 1; session.updatedAt = acceptance.acceptedAt;
    await this.repository.write(session, { documents: [], receipts: [] });
  }
  async accept(input: { changeSessionId: string; requestId: string; expectedVersion: number }) {
    return this.serialize(input.changeSessionId, async () => {
      const session = await this.get(input.changeSessionId);
      if (session.acceptance) {
        if (session.acceptance.requestId !== input.requestId || session.acceptance.sessionVersion !== input.expectedVersion)
          throw new Error('REQUEST_ID_CONFLICT: proposal already accepted');
        return summarizeChangeSession(session);
      }
      if (session.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT: reread change session');
      if (session.status !== 'ready') throw new Error('Only a ready change session can be accepted');
      this.validateReady(session);
      const affected = session.documents.filter(d => session.changes.some(c => c.documentId === d.id));
      // Captured drafts must not silently replace newer edits in any live workspace.
      for (const canvas of this.bridge.list().filter(c => c.projectId === session.projectId)) for (const live of canvas.documents) {
        const doc = affected.find(d => d.id === live.documentId || !!d.representationId && d.representationId === live.representationId);
        if (!doc?.baseline) continue;
        const current = await this.bridge.dispatch(canvas.canvasId, { method: 'document-state', documentId: live.documentId }) as LiveDocumentState;
        if (stateKey(current.document) !== stateKey(doc.baseline.document) || current.name !== doc.name)
          throw new Error('VERSION_CONFLICT: live canvas changed since capture; create a new proposal');
      }
      const acceptance = await this.source.projectCatalogs.acceptCanvasChanges(session.projectId, {
        changeSessionId: session.id, sessionVersion: session.version, requestId: input.requestId, changeIds: session.changes.map(c => c.id),
        documents: affected.map(doc => ({ documentId: doc.id, representationId: doc.representationId, expectedRevisionId: doc.savedRevisionId,
          name: doc.name, repositoryId: doc.repositoryId ?? session.repositoryId, document: doc.proposed.document, history: this.controller(doc).exportHistory() }))
      });
      // The catalog receipt recovers this step after a crash or a failed session write.
      await this.finishAcceptance(session, acceptance);
      return summarizeChangeSession(session);
    });
  }
  async create(input: { title: string; description?: string; canvasId?: string; requestId: string; repositoryId?: string; commits?: string[]; head?: string; comparisonBase?: string | null; diffTree?: DiffTreeInput }, captured?: ChangeSessionCapture) {
    const projectId = await this.projectId();
    const id = `change-${createHash('sha256').update(`${projectId}:${input.requestId}`).digest('hex').slice(0,32)}`;
    return this.serialize(id, async () => {
      const signature = JSON.stringify(captured ? { input, captureHash: stateKey(captured) } : input);
      const prior = await this.repository.read(projectId, id).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (prior) {
        if (prior.receipts.create?.signature !== signature) throw new Error('REQUEST_ID_CONFLICT');
        return prior.receipts.create.result;
      }
      const capture = captured ?? await this.capture(input);
      if (capture.projectId !== projectId) throw Error('Captured context belongs to another project');
      const { context, hunks } = capture;
      if (input.diffTree && !context) throw Error('DiffTree requires pinned repository context');
      const diffTree = context ? input.diffTree ? writeDiffTree(this.diagrams, input.diffTree, hunks) : defaultDiffTree(this.diagrams, hunks) : undefined;
      const documents = new Map(capture.documents.map(doc => [doc.id, structuredClone(doc)]));
      const result = { ...context, ...(diffTree ? { diffTree: diffTreeSummary(diffTree) } : {}), changeSessionId: id, canvasId: id, version: 0, documents: [...documents.values()].map(d => ({ documentId: d.id, name: d.name })) };
      const now = new Date().toISOString();
      await this.repository.write({ ...context, ...(diffTree ? { diffTree } : {}), schemaVersion: 1, id, projectId, title: input.title, description: input.description ?? '', status: 'draft', version: 0,
        createdAt: now, updatedAt: now, documents: [...documents.values()], changes: [], receipts: { create: { signature, result } } });
      return result;
    });
  }
  /** Freeze exactly the inputs the workflow analyzes, without creating a proposal. */
  async capture(input: { repositoryId?: string; commits?: string[]; head?: string; comparisonBase?: string | null; canvasId?: string; baselineChangeSessionId?: string }): Promise<ChangeSessionCapture> {
    const projectId = await this.projectId();
    if (input.baselineChangeSessionId) {
      const original = await this.get(input.baselineChangeSessionId);
      if (!original.repositoryId || !original.commits || !original.head || !original.diffTree) throw Error('Baseline session has no pinned Git context');
      if (input.repositoryId || input.commits || input.head || input.canvasId || input.comparisonBase !== undefined) throw Error('A baseline session supplies its own repository, commits and canvases');
      const documents = original.documents.filter(doc => doc.baseline).map(doc => {
        const baseline = structuredClone(doc.baseline!);
        return { id: doc.id, name: doc.name, representationId: doc.representationId, savedRevisionId: doc.savedRevisionId,
          repositoryId: doc.repositoryId ?? original.repositoryId, baseline, proposed: structuredClone(baseline),
          history: this.forkHistory(baseline), version: 0, past: [], future: [] } satisfies ChangeSessionDocument;
      });
      if (!documents.length) throw Error('Baseline session has no original canvases');
      return { projectId, baselineChangeSessionId: original.id,
        context: { repositoryId: original.repositoryId, commits: [...original.commits], head: original.head, ...(original.comparisonBase !== undefined ? { comparisonBase: original.comparisonBase } : {}) },
        hunks: structuredClone(original.diffTree.hunks), documents };
    }
    if (!this.source.repositories && (input.repositoryId || input.commits?.length || input.head)) throw Error('Repository registry unavailable');
    const context = await this.source.repositories?.resolveContext(input);
    const hunks = context ? await this.captureHunks(context) : [];
    const documents = new Map<string, ChangeSessionDocument>();
    const catalog = await (this.source.projectCatalogs.loadCurrentRepresentationCatalog?.(projectId) ?? this.source.projectCatalogs.loadRepresentationCatalog(projectId));
    for (const rep of Object.values(catalog.representations).filter(r => r.status === 'settled' && (!context || r.repositoryId === context.repositoryId))) {
      const revision = catalog.revisions[rep.currentRevisionId];
      const baseline = { document: documentFromRevision(revision), canvas: initialCanvasState() };
      documents.set(rep.id, { id: rep.id, name: rep.name, repositoryId: rep.repositoryId, representationId: rep.id, savedRevisionId: revision.id, history: this.forkHistory(baseline),
        baseline, proposed: structuredClone(baseline), version: 0, past: [], future: [] });
    }
    const live = this.bridge.list().filter(c => c.projectId === projectId && (!input.canvasId || c.canvasId === input.canvasId));
    if (input.canvasId && !live.length) throw new Error('Unknown project canvas');
    if (!input.canvasId && live.length > 1) throw new Error('Multiple live workspaces: specify canvasId to capture drafts');
    for (const canvas of live) for (const doc of canvas.documents) {
      const saved = catalog.representations[doc.representationId ?? doc.documentId];
      if (context && (saved?.repositoryId ?? doc.repositoryId) !== context.repositoryId) continue;
      const snapshot = await this.bridge.dispatch(canvas.canvasId, { method: 'snapshot', documentId: doc.documentId, payload: { currentRevisions: true } }) as LiveDocumentSnapshot;
      if (context && (saved?.repositoryId ?? snapshot.repositoryId ?? doc.repositoryId) !== context.repositoryId) throw Error('Canvas repository changed during capture');
      for (const revision of snapshot.revisions ?? []) new RevisionedDiagramService().importRevision(revision);
      const baseline = structuredClone({ document: snapshot.document, canvas: snapshot.canvas });
      const key = snapshot.representationId ?? doc.representationId ?? doc.documentId;
      documents.set(key, { id: key, name: snapshot.name, repositoryId: saved?.repositoryId ?? snapshot.repositoryId ?? doc.repositoryId, representationId: snapshot.representationId ?? doc.representationId,
        history: this.forkHistory(baseline),
        savedRevisionId: snapshot.revisionId, capturedVersion: snapshot.version, baseline, proposed: structuredClone(baseline), version: 0, past: [], future: [] });
    }
    return { projectId, context, hunks, documents: [...documents.values()] };
  }
  private forkHistory(state: ChangeDocumentState, history?: import('../../../domain/core/diagrams/canvasHistory').CanvasHistoryRecord) {
    const context = this.historyService.openContext(state.document, state.canvas, history);
    return this.historyService.forkContext(context, state.canvas);
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
        await this.repository.write(session, { documents: [], receipts: [key] });
      });
      return result;
    });
  }
  async descriptor(id: string) { const s = await this.get(id); return [{ canvasId: s.id, projectId: s.projectId,
    documents: s.documents.map(d => ({ documentId: d.id, name: d.name, repositoryId: d.repositoryId, representationId: d.representationId })) }]; }
  private document(session: DiagramChangeSession, id: string) { const doc = session.documents.find(d => d.id === id); if (!doc) throw new Error('Unknown change-session document'); return doc; }
  async snapshot(id: string, documentId: string): Promise<LiveDocumentSnapshot> {
    const s = await this.get(id), doc = this.document(s, documentId);
    return { ...structuredClone(doc.proposed), name: doc.name, repositoryId: doc.repositoryId, representationId: doc.representationId, revisionId: doc.savedRevisionId,
      version: doc.version, contextId: doc.history?.contextId, canUndo: !!(doc.history?.past.length || doc.past.length), canRedo: !!(doc.history?.future.length || doc.future.length) } as LiveDocumentSnapshot;
  }
  private async mutate<T>(id: string, requestId: string, signature: string, fn: (s: DiagramChangeSession) => T) {
    return this.serialize(id, async () => {
      const s = await this.get(id), key = `request:${requestId}`, receipt = s.receipts[key];
      if (receipt) { if (receipt.signature !== signature) throw new Error('REQUEST_ID_CONFLICT'); return receipt.result as T; }
      if (s.status === 'archived') throw new Error('Change session is archived');
      if (s.status === 'accepted') throw new Error('Change session is accepted and cannot be edited');
      if (Object.keys(s.receipts).length >= 2000) throw new Error('Change session request capacity reached');
      const before = new Map(s.documents.map(doc => [doc.id, doc.version]));
      const previousDiffTree = s.diffTree;
      const result = fn(s);
      s.version++; s.updatedAt = new Date().toISOString(); s.receipts[key] = { signature, result };
      await this.repository.write(s, { documents: s.documents.filter(doc => before.get(doc.id) !== doc.version).map(doc => doc.id), receipts: [key], diffTree: s.diffTree !== previousDiffTree });
      return result;
    });
  }
  async apply(id: string, documentId: string, version: number, operations: DiagramOperation[], requestId: string) {
    return this.mutate(id, requestId, JSON.stringify({ documentId, version, operations }), s => {
      const doc = this.document(s, documentId);
      const controller = this.controller(doc);
      const result = controller.applyUpdate(version, operations);
      this.record(doc, controller);
      this.refreshChanges(s, new Set([documentId])); s.status = 'draft';
      return result;
    });
  }
  private controller(doc: ChangeSessionDocument) {
    // Older proposals are imported once, preserving their available undo states.
    if (!doc.history) {
      const baseline = doc.baseline ?? doc.past[0] ?? doc.proposed;
      const context = this.historyService.openContext(baseline.document, baseline.canvas);
      const record = this.historyService.exportContext(context);
      const states = [...doc.past, doc.proposed, ...[...doc.future].reverse()];
      const ids: string[] = [];
      for (const state of states) {
        this.historyService.append(context, state.document, state.canvas);
        ids.push(this.historyService.state(context).checkpointId);
      }
      const migrated = this.historyService.exportContext(context);
      states.forEach((state, index) => {
        if (state.nodeOrigins) migrated.snapshots[ids[index]].nodeOrigins = structuredClone(state.nodeOrigins);
      });
      migrated.baselineId = record.baselineId;
      migrated.headId = ids[doc.past.length];
      migrated.past = ids.slice(0, doc.past.length);
      migrated.future = ids.slice(doc.past.length + 1).reverse();
      doc.history = migrated;
    }
    return new MappingDocumentController(doc.proposed.document, doc.proposed.canvas, doc.version, undefined, undefined, doc.history, this.diagrams, this.historyService);
  }
  private record(doc: ChangeSessionDocument, controller: MappingDocumentController) {
    const snapshot = controller.getSnapshot();
    doc.history = controller.exportHistory();
    doc.proposed = { document: snapshot.document, canvas: snapshot.canvas,
      nodeOrigins: doc.history.snapshots[doc.history.headId].nodeOrigins };
    doc.version = snapshot.version;
    // Canonical history owns undo/redo; these remain empty for old readers.
    doc.past = []; doc.future = [];
  }
  async createDocument(id: string, name: string, requestId: string) {
    return this.mutate(id, requestId, JSON.stringify({ name }), s => {
      const documentId = `draft-${randomUUID()}`;
      s.documents.push({ id: documentId, name, repositoryId: s.repositoryId, baseline: null, proposed: { document: mappingDocumentFromScene(singleDiagramScene('[New diagram]')),
        canvas: initialCanvasState() }, version: 0, past: [], future: [] });
      this.controller(s.documents[s.documents.length - 1]);
      this.refreshChanges(s, new Set([documentId])); s.status = 'draft'; return { documentId };
    });
  }
  private refreshChanges(s: DiagramChangeSession, affected: ReadonlySet<string>) {
    const changes: DiagramChange[] = [];
    for (const doc of s.documents) {
      if (!affected.has(doc.id)) { changes.push(...s.changes.filter(change => change.documentId === doc.id)); continue; }
      if (!doc.baseline) { changes.push({ id: `canvas:${doc.id}`, documentId: doc.id, title: doc.name, type: 3, reasons: [], dependsOn: [] }); continue; }
      if (stateKey(doc.baseline.document.variants ?? {}) !== stateKey(doc.proposed.document.variants ?? {}))
        changes.push({ id: `variants:${doc.id}`, documentId: doc.id, title: `${doc.name}: subtree variants`, type: 1, reasons: [], dependsOn: [] });
      const before = canvasDisplayNodes(doc.baseline.document, doc.baseline.canvas, 0);
      const after = canvasDisplayNodes(doc.proposed.document, doc.proposed.canvas, 0);
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
    changes?: DiagramChange[]; migrations?: DiagramMigration[]; diffTree?: DiffTreeInput; action?: 'undo'|'redo'|'reset'; documentId?: string }) {
    let captured: GitDiffHunk[] | undefined;
    if (input.diffTree) {
      const session = await this.get(input.changeSessionId);
      if (!session.repositoryId || !session.head || !session.commits) throw Error('DiffTree requires pinned repository context');
      if (!session.diffTree) captured = await this.captureHunks({ repositoryId: session.repositoryId, head: session.head, commits: session.commits, comparisonBase: session.comparisonBase });
    }
    return this.mutate(input.changeSessionId, input.requestId, JSON.stringify(input), s => {
      if (s.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT: reread change session');
      if (input.action) {
        if (!input.documentId) throw new Error('documentId is required');
        const doc = this.document(s, input.documentId);
        const controller = this.controller(doc);
        if (input.action === 'reset') {
          if (!doc.baseline) throw new Error('A new canvas has no baseline');
          controller.reset();
        } else {
          const snapshot = controller.getSnapshot();
          if (input.action === 'undo' ? !snapshot.canUndo : !snapshot.canRedo) throw new Error('No history available');
          controller.undo(input.action === 'redo');
        }
        this.record(doc, controller);
        this.refreshChanges(s, new Set([doc.id])); s.status = 'draft';
      }
      if (input.diffTree) {
        s.diffTree = writeDiffTree(this.diagrams, input.diffTree, s.diffTree?.hunks ?? captured!, s.diffTree);
        s.status = 'draft';
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
      if (input.migrations) {
        const issues = migrationIssues(s.documents, input.migrations);
        if (issues.length) throw Error(issues.map(i => `${i.migrationId} ${i.role}: ${i.message}`).join('; '));
        s.migrations = input.migrations;
        s.status = 'draft';
      }
      if (input.status === 'ready') this.validateReady(s);
      if (input.status) s.status = input.status;
      return { ...summarizeChangeSession(s), version: s.version + 1 };
    });
  }
  private validateReady(s: DiagramChangeSession) {
    if (s.diffTree) validateDiffTree(s.diffTree);
    if (s.repositoryId && s.documents.some(doc => doc.repositoryId !== s.repositoryId)) throw Error('ChangeSession contains a canvas owned by another repository');
    const issues = migrationIssues(s.documents, s.migrations ?? []);
    if (issues.length) throw Error(issues.map(i => `${i.migrationId} ${i.role}: ${i.message}`).join('; '));
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
        // The owner may be introduced/replaced by this proposal. Require its
        // containing diagram to exist in the baseline, not the owner node itself.
        && !!doc.baseline && !!connectionBox(doc.baseline.document.scene, edge.source.displayNodeId));
      if (!connected) throw new Error(`Added diagram needs an edge from an existing diagram: ${change.title}`);
    }
  }
}
