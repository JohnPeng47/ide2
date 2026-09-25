import { documentFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { ChangeSessionService } from '../changes/changeSessionService';
import { rebaseDiagramJumps } from '../../../domain/core/diagrams/diagramJump';
import { createDiagram, diagramSource, type Diagram, type DiagramSourceBinding } from '../../../domain/core/diagrams/diagram';
import { randomUUID } from 'node:crypto';
import type { CanvasSessionPort, AgentExecRuntime } from './ports';
import { agentToolSchemas, canvasApiSpec, canvasMethods, type AgentToolName, type LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import { MappingDocumentController, type DiagramOperation } from '../../../domain/mapping/workspace/mappingDocumentController';
import { sceneFromRevision, singleDiagramScene, type SaveProjectDiagramInput } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import type { MappingDiagramService } from '../diagrams/diagramService';
import type { DiagramRepository } from '../../core/ports/diagramRepository';

export class AgentDiagrammingSessionService {
  private sessions = new Map<string, { canvasId: string; documentId: string; changeSessionId?: string }>();
  private saves = new Map<string, Promise<unknown>>();
  private requests = new Map<string, { signature: string; promise: Promise<unknown> }>();
  constructor(readonly bridge: CanvasSessionPort, private readonly diagrams: MappingDiagramService,
    private readonly store: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>, private readonly runtime: AgentExecRuntime, readonly changes?: ChangeSessionService) {}
  async call(name: AgentToolName, raw: unknown): Promise<unknown> {
    const schema = agentToolSchemas[name];
    if (!schema) throw new Error('Unknown agent tool');
    const input = schema.parse(raw);
    if ('requestId' in input) {
      const key = `${'changeSessionId' in input ? input.changeSessionId ?? '' : ''}:${name}:${'sessionId' in input ? input.sessionId ?? '' : ''}:${input.requestId}`;
      const signature = JSON.stringify(input), old = this.requests.get(key);
      if (old) { if (old.signature !== signature) throw new Error('REQUEST_ID_CONFLICT'); return old.promise; }
      if (this.requests.size >= 2000) throw new Error('Request capacity reached; restart the backend before a new session');
      const execute = () => this.execute(name, input);
      const promise = ('changeSessionId' in input && input.changeSessionId && 'sessionId' in input && input.sessionId && name !== 'save_diagram'
        ? this.changeService().request(input.changeSessionId, `${name}:${input.requestId}`, signature, execute) : execute()).catch(error => {
        // The browser deduplicates request IDs too, so a lost acknowledgement can be recovered.
        if (error instanceof Error && error.message.includes('CANVAS_TIMEOUT')) this.requests.delete(key);
        throw error;
      });
      this.requests.set(key, { signature, promise });
      return promise;
    }
    return this.execute(name, input);
  }
  private async execute(name: AgentToolName, raw: unknown): Promise<unknown> {
    if (name === 'create_diagram_change_session') return this.changeService().create(agentToolSchemas[name].parse(raw));
    if (name === 'update_diagram_change_session') return this.changeService().update(agentToolSchemas[name].parse(raw));
    if (name === 'canvas-api-search') return canvasApiSpec(agentToolSchemas[name].parse(raw).query);
    if (name === 'diagram-search') return this.search(agentToolSchemas[name].parse(raw));
    if (name === 'exec') return this.exec(agentToolSchemas[name].parse(raw));
    if (name === 'save_diagram') return this.save(agentToolSchemas[name].parse(raw));
    if (name === 'set_diagram_source_mappings') {
      const { sessionId, changeSessionId, expectedVersion, requestId, ...fields } = agentToolSchemas[name].parse(raw);
      return this.apply(sessionId, expectedVersion, [{ method: 'setSourceMappings', ...fields }], requestId, changeSessionId);
    }
    const input = agentToolSchemas.draw_diagram.parse(raw);
    const operation = input.nodeId ? { method: 'replace', nodeId: input.nodeId, ...this.content(input) }
      : { method: 'diagram-create', id: `diagram-${randomUUID()}`, parentId: input.parentId, position: input.position, ...this.content(input) };
    return this.apply(input.sessionId, input.expectedVersion, [operation as DiagramOperation], input.requestId, input.changeSessionId);
  }
  private changeService() { if (!this.changes) throw new Error('Change sessions unavailable'); return this.changes; }
  private content(input: { ascii: string; structureKind?: 'diagram'|'tree'; mappings?: unknown; evidence?: unknown; source?: DiagramSourceBinding }) {
    return { ascii: input.ascii, structureKind: input.structureKind, mappings: input.mappings, evidence: input.evidence, source: input.source };
  }
  private session(id: string, changeSessionId?: string) {
    const session = this.sessions.get(id);
    if (session && session.changeSessionId !== changeSessionId) throw new Error('CHANGE_SESSION_MISMATCH: attachment and changeSessionId must match');
    if (!session || !session.changeSessionId && !this.bridge.list().some(canvas => canvas.canvasId === session.canvasId)) throw new Error('SESSION_UNAVAILABLE: attach to a live canvas');
    return session;
  }
  private async snapshot(sessionId: string, changeSessionId?: string): Promise<LiveDocumentSnapshot> {
    const session = this.session(sessionId, changeSessionId);
    if (session.changeSessionId) return this.changeService().snapshot(session.changeSessionId, session.documentId);
    return await this.bridge.dispatch(session.canvasId, { method: 'snapshot', documentId: session.documentId }) as LiveDocumentSnapshot;
  }
  private async attach(canvasId: string, documentId: string, changeSessionId?: string) {
    const canvases = changeSessionId ? await this.changeService().descriptor(changeSessionId) : this.bridge.list();
    if (!canvases.some(canvas => canvas.canvasId === canvasId && canvas.documents.some(doc => doc.documentId === documentId))) throw new Error('Unknown live document');
    if (this.sessions.size >= 500) throw new Error('Session capacity reached');
    const sessionId = randomUUID(); this.sessions.set(sessionId, { canvasId, documentId, changeSessionId });
    const snapshot = await this.snapshot(sessionId, changeSessionId);
    return { sessionId, canvasId, documentId, changeSessionId, version: snapshot.version };
  }
  private async apply(sessionId: string, expectedVersion: number, operations: DiagramOperation[], requestId: string, changeSessionId?: string) {
    const session = this.session(sessionId, changeSessionId);
    if (session.changeSessionId) return this.changeService().apply(session.changeSessionId, session.documentId, expectedVersion, operations, requestId);
    return this.bridge.dispatch(session.canvasId, { method: 'apply', documentId: session.documentId, payload: { expectedVersion, operations, requestId } });
  }
  private async exec(input: ReturnType<typeof agentToolSchemas.exec.parse>) {
    const original = input.sessionId ? await this.snapshot(input.sessionId, input.changeSessionId) : undefined;
    const shadow = original ? new MappingDocumentController(original.document, original.canvas, original.version, original.cell, original.endpointBounds, original.history) : undefined;
    const operations: DiagramOperation[] = [];
    let createdDocument = false;
    const value = await this.runtime.run(input.code, async (method, args) => {
      const entry = canvasMethods[method as keyof typeof canvasMethods];
      if (!entry) throw new Error('Unknown canvas method');
      const parsed = entry.schema.parse(args) as Record<string, any>;
      if (method === 'canvas.list') return input.changeSessionId ? this.changeService().descriptor(input.changeSessionId) : this.bridge.list();
      if (method === 'canvas.attach') return this.attach(parsed.canvasId, parsed.documentId, input.changeSessionId);
      if (method === 'canvas.createDocument') {
        if (input.sessionId || createdDocument) throw new Error('Create one document per unbound exec call');
        createdDocument = true;
        if (input.changeSessionId) {
          if (parsed.canvasId !== input.changeSessionId) throw new Error('CHANGE_SESSION_MISMATCH');
          const result = await this.changeService().createDocument(input.changeSessionId, parsed.name, input.requestId);
          return this.attach(parsed.canvasId, result.documentId, input.changeSessionId);
        }
        const result = await this.bridge.dispatch(parsed.canvasId, { method: 'create-document', payload: { name: parsed.name, requestId: input.requestId, snapshot: await this.diagrams.initialize() } }) as { documentId: string };
        return this.attach(parsed.canvasId, result.documentId);
      }
      if (!shadow || !original || !input.sessionId) throw new Error('sessionId is required for node operations');
      if (method === 'edges.list') return { version: original.version + Number(operations.length > 0), edges: shadow.getSnapshot().document.edges };
      if (method === 'nodes.list') { const version = original.version + Number(operations.length > 0); return { version, nodes: shadow.nodes().map(node => ({ ...node, version })) }; }
      if (method === 'nodes.get') {
        const node = shadow.nodes().find(node => node.id === parsed.nodeId);
        if (!node) throw new Error('Unknown DisplayNode');
        return { ...node, version: original.version + Number(operations.length > 0) };
      }
      if (input.expectedVersion !== original.version) throw new Error('VERSION_CONFLICT: mutations require current expectedVersion');
      if (method.startsWith('edges.')) {
        const operation: DiagramOperation = method === 'edges.remove' ? { method: 'edge-remove', edgeId: parsed.edgeId }
          : { method: method === 'edges.create' ? 'edge-create' : 'edge-update', edge: { ...parsed, id: method === 'edges.create' ? `connection-${randomUUID()}` : parsed.id } as import('../../../domain/core/diagrams/diagramConnection').DiagramConnection };
        operations.push(operation);
        shadow.transact(shadow.getSnapshot().version, [operation]);
        return 'edge' in operation ? operation.edge : null;
      }
      const operation = method === 'nodes.draw' ? { ...parsed, method: 'diagram-create', id: `diagram-${randomUUID()}` } : { ...parsed, method: method.slice(6) };
      operations.push(operation as DiagramOperation);
      shadow.transact(shadow.getSnapshot().version, [operation as DiagramOperation]);
      const node = method === 'nodes.draw' ? shadow.nodes().find(node => node.id === `grid:${"id" in operation ? operation.id : ""}`) : shadow.nodes().find(node => node.id === parsed.nodeId);
      return node ? { ...node, version: original.version + 1 } : null;
    });
    if (!operations.length) return { value, ...(original ? { version: original.version } : {}) };
    const result = await this.apply(input.sessionId!, original!.version, operations, input.requestId, input.changeSessionId);
    return { value, transaction: result };
  }
  private async search(input: ReturnType<(typeof agentToolSchemas)['diagram-search']['parse']>) {
    if (input.changeSessionId && !input.sessionId) {
      const session = await this.changeService().get(input.changeSessionId);
      if (input.revisionId) throw new Error('Session reads use pinned proposal documents, not catalog revisions');
      const docs = session.documents.filter(d => !input.representationId || d.id === input.representationId || d.representationId === input.representationId);
      if (input.operation === 'read') {
        if (docs.length !== 1) throw new Error('Specify representationId (or session document ID) for a session read');
        const doc = docs[0];
        return { origin: 'change-session', changeSessionId: session.id, documentId: doc.id, name: doc.name, version: doc.version,
          nodes: new MappingDocumentController(doc.proposed.document, doc.proposed.canvas, doc.version).nodes(),
          changeSession: { version: session.version, title: session.title, status: session.status, changes: session.changes } };
      }
      const hits = docs.flatMap(doc => new MappingDocumentController(doc.proposed.document, doc.proposed.canvas).nodes().flatMap(node =>
        node.layout === 'grid' && node.diagram ? this.matches(node.diagram, input).map(match => ({ origin: 'change-session', documentId: doc.id,
          representationId: doc.representationId, name: doc.name, nodeId: node.id, version: doc.version, ...match })) : []));
      return { total: hits.length, hits: hits.slice(input.offset, input.offset + input.limit),
        changeSession: { version: session.version, title: session.title, status: session.status, changes: session.changes } };
    }
    if (input.sessionId) {
      const snapshot = await this.snapshot(input.sessionId, input.changeSessionId);
      const controller = new MappingDocumentController(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds);
      const nodes = controller.nodes().filter(node => node.layout === 'grid' && node.kind === 'diagram');
      if (input.operation === 'read') {
        const node = nodes.find(node => node.id === input.nodeId);
        if (!node) throw new Error('A valid live nodeId is required');
        return { origin: 'live', version: snapshot.version, node, evidence: node.layout === 'grid' ? node.diagram?.sourceContext.evidence ?? {} : {} };
      }
      const hits = nodes.flatMap(node => node.layout === 'grid' && node.content ? this.matches(node.diagram!, input).map(match => ({ origin: 'live', nodeId: node.id, version: snapshot.version, ...match })) : []);
      return { total: hits.length, hits: hits.slice(input.offset, input.offset + input.limit) };
    }
    const project = await this.store.loadProject();
    if (!project) { if (input.operation === 'read') throw new Error('Project is not initialized'); return { total: 0, hits: [] }; }
    const catalog = await this.store.projectCatalogs.loadRepresentationCatalog(project.id);
    const representations = Object.values(catalog.representations).filter(rep => rep.status === 'settled' && (!input.representationId || rep.id === input.representationId));
    if (input.operation === 'read') {
      const representation = representations.find(rep => rep.id === input.representationId);
      if (!representation) throw new Error('A valid representationId is required');
      const revisionId = input.revisionId ?? representation.currentRevisionId;
      if (!representation.revisionIds.includes(revisionId)) throw new Error('Revision does not belong to representation');
      const revision = catalog.revisions[revisionId];
      const document = documentFromRevision(revision);
      return { origin: 'saved', representation, revision, nodes: new MappingDocumentController(document, initialCanvasState()).nodes() };
    }
    const hits: unknown[] = [];
    for (const representation of representations) {
      const revision = catalog.revisions[representation.currentRevisionId];
      const document = documentFromRevision(revision);
      const nodes = new MappingDocumentController(document, initialCanvasState()).nodes();
      const query = (input.query ?? '').toLowerCase();
      for (const node of nodes) if (node.layout === 'grid' && node.content) {
        const matches = this.matches(node.diagram!, input);
        if ((!input.mode || input.mode === 'text') && representation.name.toLowerCase().includes(query) && !matches.length) matches.push({ snippet: representation.name });
        for (const match of matches) hits.push({ origin: 'saved', representationId: representation.id, revisionId: revision.id, name: representation.name, nodeId: node.id, ...match });
      }
    }
    return { total: hits.length, hits: hits.slice(input.offset, input.offset + input.limit), nextOffset: input.offset + input.limit < hits.length ? input.offset + input.limit : null };
  }
  private matches(diagram: Diagram, input: ReturnType<(typeof agentToolSchemas)['diagram-search']['parse']>): { snippet: string; contentNodeId?: string; evidenceId?: string; line?: number }[] {
    const content = diagram.content, source = diagramSource(diagram);
    const q = (input.query ?? '').toLowerCase();
    if (input.mode === 'code-reference') return source.search(q).map(({mapping,entity}) => ({ snippet: entity.label, evidenceId: mapping.entityId, line: mapping.line }));
    if (input.mode === 'node') {
      const nodes = content.structure.kind === 'tree' ? Object.values(content.structure.nodes) : [];
      return [...nodes.filter(node => `${node.id} ${node.label}`.toLowerCase().includes(q)).map(node => ({ snippet: node.label, contentNodeId: node.id, line: node.line })),
        ...source.entries().filter(({mapping,entity}) => `${mapping.id} ${entity.label}`.toLowerCase().includes(q)).map(({mapping,entity}) => ({ snippet: entity.label, contentNodeId: mapping.id, line: mapping.line }))];
    }
    return content.ascii.split('\n').flatMap((line, i) => line.toLowerCase().includes(q) ? [{ snippet: line, line: i + 1 }] : []);
  }
  private save(input: ReturnType<typeof agentToolSchemas.save_diagram.parse>) {
    this.session(input.sessionId, input.changeSessionId);
    if (input.changeSessionId) throw new Error('CHANGE_SESSION_SAVE_FORBIDDEN: preview edits cannot publish catalog revisions');
    const session = this.session(input.sessionId), key = `${session.canvasId}:${session.documentId}`;
    const previous = this.saves.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => this.saveNow(input));
    this.saves.set(key, result);
    void result.finally(() => { if (this.saves.get(key) === result) this.saves.delete(key); }).catch(() => undefined);
    return result;
  }
  private async saveNow(input: ReturnType<typeof agentToolSchemas.save_diagram.parse>) {
    const session = this.session(input.sessionId), snapshot = await this.snapshot(input.sessionId, input.changeSessionId);
    if (input.expectedVersion !== snapshot.version) throw new Error('VERSION_CONFLICT: read the canvas again');
    let scene = snapshot.document.scene;
    if (input.nodeId) {
      const node = new MappingDocumentController(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds).nodes().find(node => node.id === input.nodeId);
      if (!node || node.layout !== 'grid' || node.kind !== 'diagram') throw new Error('Expected diagram GridBox');
      const box = findBox(scene.root, node.boxId)!;
      if (box.kind !== 'diagram') throw new Error('Expected diagram');
      const content = scene.contents[box.contentId];
      const isolated = singleDiagramScene(content.content.ascii);
      scene = { ...isolated, contents: { ...isolated.contents, overview: createDiagram({id:'overview', revision:content.revision, ascii:content.content.ascii, structureKind:content.content.structure.kind, source:content.sourceContext.binding, evidence:content.sourceContext.evidence, mappings:content.sourceContext.mappings}) } };
      if (content.jumps) scene.contents.overview.jumps = rebaseDiagramJumps(content.content, scene.contents.overview.content, content.jumps);
    }
    const representationId = input.representationId ?? (!input.nodeId ? snapshot.representationId : undefined);
    const save: SaveProjectDiagramInput = { name: input.name, history: input.nodeId ? undefined : snapshot.history, scene, edges: input.nodeId ? [] : snapshot.document.edges, representationId,
      expectedRevisionId: input.expectedRevisionId ?? (representationId === snapshot.representationId ? snapshot.revisionId : undefined) };
    const result = await this.diagrams.save(save);
    let displayUpdated = true;
    try { await this.bridge.dispatch(session.canvasId, { method: 'saved', documentId: session.documentId, payload: { result, capturedVersion: snapshot.version, wholeDocument: !input.nodeId, savedScene: JSON.stringify(scene), savedEdges: JSON.stringify(input.nodeId ? [] : snapshot.document.edges), name: input.name } }); }
    catch { displayUpdated = false; }
    return { representationId: result.representation.id, revisionId: result.representation.currentRevisionId, version: snapshot.version, displayUpdated };
  }
}
