import { summarizeChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
import { CanvasApiProjection } from './apiProjection';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import type { DiagramJump } from '../../../domain/core/diagrams/diagramJump';
import type { AgentContextService } from './agentContextService';
import { DiagramEditService } from './diagramEditService';
import { DefaultCanvasHistoryService } from '../../../domain/core/diagrams/canvasHistoryService';
import { documentFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { ChangeSessionService } from '../changes/changeSessionService';
import { rebaseDiagramJumps } from '../../../domain/core/diagrams/diagramJump';
import { diagramSource, type Diagram, type DiagramSourceBinding } from '../../../domain/core/diagrams/diagram';
import { RevisionedDiagramService, type DiagramService } from '../../../domain/core/diagrams/diagramService';
import { createHash, randomUUID } from 'node:crypto';
import type { CanvasSessionPort, AgentExecRuntime } from './ports';
import { agentToolSchemas, canvasApiSpec, canvasMethods, type AgentToolName, type LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import { MappingDocumentController, type DiagramOperation } from '../../../domain/mapping/workspace/mappingDocumentController';
import { sceneFromRevision, singleDiagramScene, type SaveProjectDiagramInput } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { canvasDisplayNodes, findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import type { MappingDiagramService } from '../diagrams/diagramService';
import type { DiagramRepository } from '../../core/ports/diagramRepository';

type EditResult = ReturnType<MappingDocumentController['applyUpdate']>;
interface ExecStep {
  signature: string;
  execute: () => Promise<unknown>;
  outcome?: { value: unknown } | { error: unknown };
}
interface ExecRun {
  signature: string;
  initialVersion?: number;
  version?: number;
  nodes?: EditResult['nodes'];
  edges?: LiveDocumentSnapshot['document']['edges'];
  lastEdit?: EditResult;
  createdDocument: boolean;
  steps: ExecStep[];
}
const canvasTimeout = (error: unknown) => error instanceof Error && error.message.includes('CANVAS_TIMEOUT');

export class AgentDiagrammingSessionService {
  private readonly edits?: DiagramEditService;
  private sessions = new Map<string, { canvasId: string; documentId: string; changeSessionId?: string }>();
  private saves = new Map<string, Promise<unknown>>();
  private execRuns = new Map<string, ExecRun>();
  private requests = new Map<string, { signature: string; promise: Promise<unknown> }>();
  constructor(readonly bridge: CanvasSessionPort, private readonly diagrams: MappingDiagramService,
    private readonly store: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs' | 'repositories'>, private readonly runtime: AgentExecRuntime, readonly changes?: ChangeSessionService,
    editDiagrams?: DiagramService, private readonly agentContexts?: AgentContextService, readonly projection = new CanvasApiProjection()) {
    if (editDiagrams) this.edits = new DiagramEditService(editDiagrams, {
      snapshot: sessionId => this.snapshot(sessionId),
      apply: async (sessionId, input) => {
        const session = this.session(sessionId);
        return await this.bridge.dispatch(session.canvasId, { method: 'apply-diagram-revision', documentId: session.documentId, payload: input }) as { version: number; unresolvedEdgeIds: string[] };
      },
      create: async (sessionId, input) => {
        const session = this.session(sessionId);
        return await this.bridge.dispatch(session.canvasId, { method: 'create-diagrams', documentId: session.documentId, payload: input }) as { version: number };
      }
    });
  }
  dispose() { this.edits?.dispose(); }
  async call(name: AgentToolName, raw: unknown): Promise<unknown> {
    const schema = agentToolSchemas[name];
    if (!schema) throw new Error('Unknown agent tool');
    const input = schema.parse(raw);
    if (name === 'edit-diagram' || name === 'create-diagram' || name === 'extend-diagram' || name === 'edit-diagram-status' || name === 'cancel-diagram-edit') {
      if (!this.edits) throw Error('Diagram editing UNAVAILABLE in this runtime');
      if (name === 'edit-diagram' || name === 'create-diagram' || name === 'extend-diagram') {
        const edit = agentToolSchemas[name].parse(input);
        const session = this.session(edit.sessionId); // Live attachment only; never creates a proposal.
        if (edit.agentContextId && !this.agentContexts) throw Error('AGENT_CONTEXT_UNAVAILABLE');
        const context = edit.agentContextId ? this.agentContexts!.get({ workspaceInstanceId: session.canvasId,
          documentId: session.documentId }, edit.agentContextId) : undefined;
        return this.edits.start(edit, context, name);
      }
      const { runId } = agentToolSchemas['edit-diagram-status'].parse(input);
      return name === 'edit-diagram-status' ? this.edits.get(runId) : this.edits.cancel(runId);
    }
    if ('requestId' in input) {
      const key = `${'changeSessionId' in input ? input.changeSessionId ?? '' : ''}:${name}:${'sessionId' in input ? input.sessionId ?? '' : ''}:${input.requestId}`;
      const signature = JSON.stringify(input), old = this.requests.get(key);
      if (old) { if (old.signature !== signature) throw new Error('REQUEST_ID_CONFLICT'); return old.promise; }
      if (name === 'exec') {
        const exec = input as ReturnType<typeof agentToolSchemas.exec.parse>;
        const pending = this.execRuns.get(JSON.stringify([exec.changeSessionId, exec.sessionId, exec.requestId]));
        if (pending && pending.signature !== signature) throw new Error('REQUEST_ID_CONFLICT');
      }
      if (this.requests.size >= 2000) throw new Error('Request capacity reached; restart the backend before a new session');
      const execute = () => this.execute(name, input);
      const promise = ('changeSessionId' in input && input.changeSessionId && 'sessionId' in input && input.sessionId && name !== 'save_diagram'
        ? this.changeService().request(input.changeSessionId, `${name}:${input.requestId}`, signature, execute) : execute()).catch(error => {
        // The browser deduplicates request IDs too, so a lost acknowledgement can be recovered.
        if (canvasTimeout(error)) this.requests.delete(key);
        throw error;
      });
      this.requests.set(key, { signature, promise });
      return promise;
    }
    return this.execute(name, input);
  }
  private async execute(name: AgentToolName, raw: unknown): Promise<unknown> {
    if (name === 'list_repositories' || name === 'register_repository') {
      if (!this.store.repositories) throw Error('Repository registry unavailable');
      await this.diagrams.initialize();
      return name === 'list_repositories' ? this.store.repositories.list()
        : this.store.repositories.register(agentToolSchemas.register_repository.parse(raw));
    }
    if (name === 'get_repository_diff_hunks') return this.changeService().discoverHunks(agentToolSchemas[name].parse(raw));
    if (name === 'read_change_session_diff_tree') return this.changeService().readDiffTree(agentToolSchemas[name].parse(raw));
    if (name === 'create_diagram_change_session') return this.changeService().create(agentToolSchemas[name].parse(raw));
    if (name === 'update_diagram_change_session') {
      const input = agentToolSchemas[name].parse(raw);
      const result = await this.changeService().update({ ...input,
        ...(input.migrations ? { migrations: this.projection.migrations(input.migrations, true) } : {}) });
      return { ...result, migrations: this.projection.migrations(result.migrations) };
    }
    if (name === 'accept_diagram_change_session') {
      const result = await this.changeService().accept(agentToolSchemas[name].parse(raw));
      return { ...result, migrations: this.projection.migrations(result.migrations) };
    }
    if (name === 'canvas-api-search') return canvasApiSpec(agentToolSchemas[name].parse(raw).query);
    if (name === 'diagram-search') return this.search(agentToolSchemas[name].parse(raw));
    if (name === 'exec') return this.exec(agentToolSchemas[name].parse(raw));
    if (name === 'save_diagram') return this.save(agentToolSchemas[name].parse(raw));
    if (name === 'set_diagram_source_mappings') {
      const { sessionId, changeSessionId, expectedVersion, requestId, ...fields } = agentToolSchemas[name].parse(raw);
      return this.projection.result(await this.apply(sessionId, expectedVersion, [{ method: 'setSourceMappings', ...fields }], requestId, changeSessionId) as EditResult);
    }
    const input = agentToolSchemas.draw_diagram.parse(raw);
    const operation = input.nodeId ? { method: 'replace', nodeId: input.nodeId, ...this.content(input) }
      : { method: 'diagram-create', id: `diagram-${randomUUID()}`, parentId: input.parentId, position: input.position, ...this.content(input) };
    return this.projection.result(await this.apply(input.sessionId, input.expectedVersion, [operation as DiagramOperation], input.requestId, input.changeSessionId) as EditResult);
  }
  private async requireRepository(id?: string) {
    if (!this.store.repositories) { if (id) throw Error('Repository registry unavailable'); return undefined; }
    const repositories = await this.store.repositories.list();
    const selected = id ? repositories.find(repo => repo.id === id) : repositories.length === 1 ? repositories[0] : undefined;
    if (!selected && (id || repositories.length)) throw Error('Specify a registered repositoryId');
    return selected?.id;
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
    return this.attachDocument(canvasId, documentId, changeSessionId);
  }
  private async attachDocument(canvasId: string, documentId: string, changeSessionId?: string) {
    if (this.sessions.size >= 500) throw new Error('Session capacity reached');
    const sessionId = randomUUID(); this.sessions.set(sessionId, { canvasId, documentId, changeSessionId });
    try {
      const snapshot = await this.snapshot(sessionId, changeSessionId);
      return { sessionId, canvasId, documentId, changeSessionId, repositoryId: snapshot.repositoryId, version: snapshot.version };
    } catch (error) { this.sessions.delete(sessionId); throw error; }
  }
  private async apply(sessionId: string, expectedVersion: number, operations: DiagramOperation[], requestId: string, changeSessionId?: string) {
    const session = this.session(sessionId, changeSessionId);
    if (session.changeSessionId) return this.changeService().apply(session.changeSessionId, session.documentId, expectedVersion, operations, requestId);
    return this.bridge.dispatch(session.canvasId, { method: 'apply', documentId: session.documentId, payload: { expectedVersion, operations, requestId } });
  }
  private async exec(input: ReturnType<typeof agentToolSchemas.exec.parse>) {
    const key = JSON.stringify([input.changeSessionId, input.sessionId, input.requestId]);
    const signature = JSON.stringify(input);
    let run = this.execRuns.get(key);
    if (run && run.signature !== signature) throw new Error('REQUEST_ID_CONFLICT');
    if (!run) {
      if (this.execRuns.size >= 2000) throw new Error('Execution retry capacity reached');
      const snapshot = input.sessionId ? await this.snapshot(input.sessionId, input.changeSessionId) : undefined;
      run = { signature, initialVersion: snapshot?.version, version: snapshot?.version, createdDocument: false, steps: [],
        nodes: snapshot && canvasDisplayNodes(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds),
        edges: snapshot?.document.edges };
      this.execRuns.set(key, run);
    }
    const state = run;
    // A retry replays completed API results and resends only an unacknowledged call.
    // The pending call retains its operation ID, expected version and request ID.
    const requestPrefix = `exec-${createHash('sha256').update(key).digest('hex')}`;
    let cursor = 0;
    try {
      const value = await this.runtime.run(input.code, async (method, args) => {
        const stepIndex = cursor++, stepSignature = JSON.stringify({ method, args });
        let step = state.steps[stepIndex];
        if (step && step.signature !== stepSignature) throw new Error('REQUEST_ID_CONFLICT: execution changed during retry');
        if (!step) {
          try {
            const entry = canvasMethods[method as keyof typeof canvasMethods];
            if (!entry) throw new Error('Unknown canvas method');
            const parsed = entry.schema.parse(args) as Record<string, any>;
            let execute: () => Promise<unknown>;
            if (method === 'canvas.list') execute = async () => input.changeSessionId ? this.changeService().descriptor(input.changeSessionId) : this.bridge.list();
            else if (method === 'canvas.attach') execute = () => this.attach(parsed.canvasId, parsed.documentId, input.changeSessionId);
            else if (method === 'canvas.copyDocument') {
              if (input.changeSessionId) throw new Error('Copy supports live canvases only');
              if (input.sessionId || state.createdDocument) throw new Error('Create one document per unbound exec call');
              if (!this.bridge.list().some(canvas => canvas.canvasId === parsed.canvasId && canvas.documents.some(doc => doc.documentId === parsed.documentId)))
                throw new Error('Unknown live document');
              state.createdDocument = true;
              execute = async () => {
                if (parsed.repositoryId) await this.requireRepository(parsed.repositoryId);
                const result = await this.bridge.dispatch(parsed.canvasId, { method: 'copy-document', documentId: parsed.documentId,
                  payload: { name: parsed.name, repositoryId: parsed.repositoryId, expectedVersion: parsed.expectedVersion, requestId: `${requestPrefix}:${stepIndex}` } }) as { documentId: string };
                // The browser has created the document; its descriptor refresh may still be in flight.
                return this.attachDocument(parsed.canvasId, result.documentId);
              };
            }
            else if (method === 'canvas.createDocument') {
              if (input.sessionId || state.createdDocument) throw new Error('Create one document per unbound exec call');
              state.createdDocument = true;
              if (input.changeSessionId && parsed.canvasId !== input.changeSessionId) throw new Error('CHANGE_SESSION_MISMATCH');
              execute = async () => {
                if (input.changeSessionId && parsed.repositoryId && (await this.changeService().get(input.changeSessionId)).repositoryId !== parsed.repositoryId)
                  throw Error('Proposal canvases inherit the ChangeSession repository');
                const repositoryId = input.changeSessionId ? undefined : await this.requireRepository(parsed.repositoryId);
                const result = input.changeSessionId
                  ? await this.changeService().createDocument(input.changeSessionId, parsed.name, input.requestId)
                  : await this.bridge.dispatch(parsed.canvasId, { method: 'create-document', payload: { name: parsed.name, repositoryId,
                      requestId: input.requestId, snapshot: await this.diagrams.initialize() } }) as { documentId: string };
                return this.attach(parsed.canvasId, result.documentId, input.changeSessionId);
              };
            } else {
              if (!input.sessionId || state.version === undefined) throw new Error('sessionId is required for node operations');
              const sessionId = input.sessionId;
              if (method === 'edges.list') execute = async () => {
                if (!state.edges) {
                  const snapshot = await this.snapshot(sessionId, input.changeSessionId);
                  if (snapshot.version !== state.version) throw new Error('VERSION_CONFLICT: canvas changed during execution');
                  state.edges = snapshot.document.edges;
                }
                return { version: state.version, edges: state.edges.map(edge => this.projection.edge(edge)) };
              };
              else if (method === 'nodes.list') execute = async () => ({ version: state.version, nodes: this.projection.nodes(state.nodes!) });
              else if (method === 'nodes.get') execute = async () => {
                const node = state.nodes!.find(node => node.id === parsed.nodeId);
                if (!node) throw new Error('Unknown DisplayNode');
                return this.projection.node(node);
              };
              else {
                if (input.expectedVersion !== state.initialVersion) throw new Error('VERSION_CONFLICT: mutations require current expectedVersion');
                // Decode before freezing the retry step. Domain state always retains full IDs.
                if (method === 'edges.create' || method === 'edges.update') Object.assign(parsed, this.projection.resolveEdge(parsed as Omit<import('../../../domain/core/diagrams/diagramConnection').DiagramConnection, 'id'>));
                if (method === 'nodes.collapse' && parsed.contentNodeId) parsed.contentNodeId = this.projection.resolveAnchorId(parsed.contentNodeId);
                if (method === 'nodes.setJumps') {
                  const node = state.nodes!.find(node => node.id === parsed.nodeId);
                  parsed.jumps = await this.resolveJumps(parsed.jumps, node?.layout === 'grid' ? node.diagram?.jumps : undefined);
                }
                const expectedVersion = state.version;
                const operation = (method.startsWith('edges.')
                  ? method === 'edges.remove' ? { method: 'edge-remove', edgeId: parsed.edgeId }
                    : { method: method === 'edges.create' ? 'edge-create' : 'edge-update',
                        edge: { ...parsed, id: method === 'edges.create' ? `connection-${randomUUID()}` : parsed.id } }
                  : method === 'nodes.draw' ? { ...parsed, method: 'diagram-create', id: `diagram-${randomUUID()}` }
                    : { ...parsed, method: method.slice(6) }) as DiagramOperation;
                execute = async () => {
                  const result = await this.apply(sessionId, expectedVersion, [operation], `${requestPrefix}:${stepIndex}`, input.changeSessionId) as EditResult;
                  state.version = result.version; state.nodes = result.nodes; state.edges = undefined; state.lastEdit = result;
                  if (method.startsWith('edges.')) return 'edge' in operation ? this.projection.edge(operation.edge) : null;
                  const nodeId = operation.method === 'diagram-create' ? `grid:${operation.id}` : parsed.nodeId;
                  const node = result.nodes.find(node => node.id === nodeId);
                  return node ? this.projection.node(node) : null;
                };
              }
            }
            step = { signature: stepSignature, execute };
            state.steps[stepIndex] = step;
          } catch (error) {
            state.steps[stepIndex] = { signature: stepSignature, execute: async () => { throw error; }, outcome: { error } };
            throw error;
          }
        }
        if (!step.outcome) {
          try { step.outcome = { value: await step.execute() }; }
          catch (error) { if (!canvasTimeout(error)) step.outcome = { error }; throw error; }
        }
        if ('error' in step.outcome) throw step.outcome.error;
        return step.outcome.value;
      });
      // A script may catch a transport timeout. Keep it retryable until the unknown
      // outcome is acknowledged, rather than reporting a completed execution.
      if (state.steps.some(step => !step.outcome)) throw new Error('CANVAS_TIMEOUT: retry execution with the same requestId');
      this.execRuns.delete(key);
      // Retain the response shape; transaction describes the last individual edit.
      return state.lastEdit ? { value, transaction: this.projection.result(state.lastEdit) } : { value, ...(state.version === undefined ? {} : { version: state.version }) };
    } catch (error) {
      if (!canvasTimeout(error)) this.execRuns.delete(key);
      throw error;
    }
  }
  private async resolveJumps(input: DiagramJump[], previous: readonly DiagramJump[] = []) {
    const resolved = input.map(jump => this.projection.resolveJump(jump));
    let catalog: Awaited<ReturnType<DiagramRepository['projectCatalogs']['loadRepresentationCatalog']>> | undefined;
    for (let i = 0; i < input.length; i++) {
      const handle = input[i].target.contentNodeId;
      if (!handle || !this.projection.isAnchorHandle(handle)) continue;
      const target = resolved[i].target;
      // Existing stale jumps must survive a metadata-only update, just like edges.
      if (previous.some(jump => jump.id === input[i].id && jump.target.representationId === target.representationId
        && jump.target.displayNodeId === target.displayNodeId && jump.target.contentNodeId === target.contentNodeId)) continue;
      if (!catalog) {
        const project = await this.store.loadProject();
        if (!project) throw Error('STALE_CONTENT_NODE: jump target project is unavailable');
        catalog = await this.store.projectCatalogs.loadRepresentationCatalog(project.id);
      }
      const representation = catalog.representations[target.representationId];
      const revision = representation && catalog.revisions[representation.currentRevisionId];
      const document = revision && documentFromRevision(revision);
      const box = document && target.displayNodeId?.startsWith('grid:') && findBox(document.scene.root, target.displayNodeId.slice(5));
      if (!box || box.kind !== 'diagram' || !diagramContentNodes(document!.scene.contents[box.contentId].content).some(node => node.id === target.contentNodeId))
        throw Error('STALE_CONTENT_NODE: jump handle does not belong to the target diagram revision');
    }
    return resolved;
  }
  private async search(input: ReturnType<(typeof agentToolSchemas)['diagram-search']['parse']>) {
    if (input.snapshot && (!input.changeSessionId || input.sessionId)) throw Error('snapshot requires changeSessionId without sessionId');
    if (input.changeSessionId && !input.sessionId) {
      const session = await this.changeService().get(input.changeSessionId);
      if (input.revisionId) throw new Error('Session reads use pinned proposal documents, not catalog revisions');
      const docs = session.documents.filter(d => !input.representationId || d.id === input.representationId || d.representationId === input.representationId);
      if (input.operation === 'read') {
        if (docs.length !== 1) throw new Error('Specify representationId (or session document ID) for a session read');
        const doc = docs[0], state = doc[input.snapshot ?? 'proposed'];
        if (!state) throw Error('New canvas has no baseline');
        return { origin: 'change-session', changeSessionId: session.id, documentId: doc.id, name: doc.name, version: doc.version,
          snapshot: input.snapshot ?? 'proposed',
          nodes: this.projection.nodes(canvasDisplayNodes(state.document, state.canvas, doc.version)),
          changeSession: { version: session.version, title: session.title, status: session.status, repositoryId: session.repositoryId, commits: session.commits, head: session.head, diffTree: summarizeChangeSession(session).diffTree, changes: session.changes, migrations: this.projection.migrations(session.migrations) } };
      }
      const hits = docs.flatMap(doc => {
        const state = doc[input.snapshot ?? 'proposed'];
        return state ? canvasDisplayNodes(state.document, state.canvas, doc.version).flatMap(node =>
        node.layout === 'grid' && node.diagram ? this.matches(node.diagram, input).map(match => ({ origin: 'change-session', documentId: doc.id,
          representationId: doc.representationId, name: doc.name, nodeId: node.id, version: doc.version, ...match })) : []) : [];
      });
      return { total: hits.length, hits: hits.slice(input.offset, input.offset + input.limit),
        changeSession: { version: session.version, title: session.title, status: session.status, repositoryId: session.repositoryId, commits: session.commits, head: session.head, diffTree: summarizeChangeSession(session).diffTree, changes: session.changes, migrations: this.projection.migrations(session.migrations) } };
    }
    if (input.sessionId) {
      const snapshot = await this.snapshot(input.sessionId, input.changeSessionId);
      const nodes = canvasDisplayNodes(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds).filter(node => node.layout === 'grid' && node.kind === 'diagram');
      if (input.operation === 'read') {
        const node = nodes.find(node => node.id === input.nodeId);
        if (!node) throw new Error('A valid live nodeId is required');
        return { origin: 'live', version: snapshot.version, node: this.projection.node(node), evidence: node.layout === 'grid' ? node.diagram?.sourceContext.evidence ?? {} : {} };
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
      return { origin: 'saved', representation, revision, nodes: this.projection.nodes(canvasDisplayNodes(document, initialCanvasState(), 0)) };
    }
    const hits: unknown[] = [];
    for (const representation of representations) {
      const revision = catalog.revisions[representation.currentRevisionId];
      const document = documentFromRevision(revision);
      const nodes = canvasDisplayNodes(document, initialCanvasState(), 0);
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
    const q = (input.mode === 'node' && input.query && this.projection.isAnchorHandle(input.query) ? this.projection.resolveAnchorId(input.query) : input.query ?? '').toLowerCase();
    if (input.mode === 'code-reference') return source.search(q).map(({mapping,entity}) => ({ snippet: entity.label, evidenceId: mapping.entityId, line: mapping.line }));
    if (input.mode === 'node') {
      const nodes = content.structure.kind === 'tree' ? Object.values(content.structure.nodes) : [];
      return [...nodes.filter(node => `${node.id} ${node.label}`.toLowerCase().includes(q)).map(node => ({ snippet: node.label, contentNodeId: this.projection.anchorId(node.id), line: node.line })),
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
    let scene = snapshot.document.scene, history = snapshot.history;
    if (input.nodeId) {
      const node = canvasDisplayNodes(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds).find(node => node.id === input.nodeId);
      if (!node || node.layout !== 'grid' || node.kind !== 'diagram') throw new Error('Expected diagram GridBox');
      const box = findBox(scene.root, node.boxId)!;
      if (box.kind !== 'diagram') throw new Error('Expected diagram');
      const content = scene.contents[box.contentId];
      const isolated = singleDiagramScene(content.content.ascii);
      scene = { ...isolated, contents: { ...isolated.contents, overview: new RevisionedDiagramService().create({id:'overview', revision:content.revision, ascii:content.content.ascii, structureKind:content.content.structure.kind, source:content.sourceContext.binding, evidence:content.sourceContext.evidence, mappings:content.sourceContext.mappings}).diagram } };
      if (content.jumps) scene = { ...scene, contents: { ...scene.contents, overview: new RevisionedDiagramService().revise(
        scene.contents.overview.revisionId, { kind: 'jumps', jumps: rebaseDiagramJumps(content.content, scene.contents.overview.content, content.jumps) }).diagram } };
      const histories = new DefaultCanvasHistoryService();
      history = histories.exportContext(histories.openContext({ scene, edges: [], sections: {} }, snapshot.canvas));
    }
    const representationId = input.representationId ?? (!input.nodeId ? snapshot.representationId : undefined);
    if (!history) throw new Error('Canvas history is required to save');
    const save: SaveProjectDiagramInput = { repositoryId: input.repositoryId ?? snapshot.repositoryId, name: input.name, history, scene, edges: input.nodeId ? [] : snapshot.document.edges, representationId,
      expectedRevisionId: input.expectedRevisionId ?? (representationId === snapshot.representationId ? snapshot.revisionId : undefined) };
    const result = await this.diagrams.save(save);
    let displayUpdated = true;
    try { await this.bridge.dispatch(session.canvasId, { method: 'saved', documentId: session.documentId, payload: { result, capturedVersion: snapshot.version, wholeDocument: !input.nodeId, savedScene: JSON.stringify(scene), savedEdges: JSON.stringify(input.nodeId ? [] : snapshot.document.edges), name: input.name } }); }
    catch { displayUpdated = false; }
    return { representationId: result.representation.id, revisionId: result.representation.currentRevisionId, version: snapshot.version, displayUpdated };
  }
}
