import { getDiagramRevision } from '../../../domain/core/diagrams/diagramRevisionStore';
import { presentationHighlights } from '../../../domain/core/presentation/diagramPresentation';
import { createStoredDiagram, reviseStoredDiagram } from '../../../domain/core/diagrams/diagramRevisionStore';
import { DiagramBatchService } from './diagramBatchService';
import { isDiagramTool, directBatchSchemas, type DiagramTool, type DiagramBatchApplication } from '../../../domain/mapping/agent/diagramBatch';
import { reviewRevision, reviewRevisionIds } from '../../../domain/core/diagrams/diagramRevisionReview';
import { canvasMutationResult, type CanvasMutationResult } from '../../../domain/mapping/agent/mutationReceipt';
import { ChatCanvasBindings } from './chatBindings';
import { CanvasReadAliases } from './readAliases';
import { currentCanvasRead } from '../../../domain/mapping/agent/currentCanvasRead';
import { rebaseDiagramHighlights } from '../../../domain/core/diagrams/diagramHighlight';
import { correspondingNodes } from '../../../domain/core/diagrams/diagramRevisionEditor';
import { summarizeChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
import { CanvasApiProjection } from './apiProjection';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { compileDiagramAgentContext, diagramContextSourceFingerprint, loadDiagramAgentContext, storeDiagramAgentContext,
  type DiagramAgentContextStore } from '../../../domain/core/diagrams/diagramAgentContext';
import type { DiagramJump } from '../../../domain/core/diagrams/diagramJump';
import type { AgentContextService } from './agentContextService';
import { DiagramEditService } from './diagramEditService';
import { DefaultCanvasHistoryService } from '../../../domain/core/diagrams/canvasHistoryService';
import { documentFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { ChangeSessionService } from '../changes/changeSessionService';
import { rebaseDiagramJumps } from '../../../domain/core/diagrams/diagramJump';
import { diagramSource, type Diagram, type DiagramSourceBinding } from '../../../domain/core/diagrams/diagram';
import type { DiagramGenerator } from '../../../domain/core/diagrams/diagramGeneration';
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
  operation?: DiagramOperation;
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
  batches: Map<number, { indices: number[]; expectedVersion: number; result?: CanvasMutationResult; error?: unknown }>;
}
const canvasTimeout = (error: unknown) => error instanceof Error && /CANVAS_TIMEOUT|CANVAS_REPLY_TOO_LARGE|CANVAS_REPLY_REJECTED/.test(error.message);

export class AgentDiagrammingSessionService {
  readonly chatBindings = new ChatCanvasBindings();
  private readonly aliases = new CanvasReadAliases();
  private readonly edits?: DiagramEditService;
  private readonly batches?: DiagramBatchService;
  private sessions = new Map<string, { canvasId: string; documentId: string; changeSessionId?: string }>();
  private saves = new Map<string, Promise<unknown>>();
  private execRuns = new Map<string, ExecRun>();
  private requests = new Map<string, { signature: string; promise: Promise<unknown> }>();
  private diagramContextMutations = new Map<string, { signature: string; canvasId: string; documentId: string; payload: Record<string, unknown> }>();
  constructor(readonly bridge: CanvasSessionPort, private readonly diagrams: MappingDiagramService,
    private readonly store: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs' | 'repositories'>, private readonly runtime: AgentExecRuntime, readonly changes?: ChangeSessionService,
    editDiagrams?: DiagramGenerator, private readonly agentContexts?: AgentContextService, readonly projection = new CanvasApiProjection(),
    private readonly diagramContextStore?: DiagramAgentContextStore) {
    if (editDiagrams) {
      const canvas = {
        snapshot: (sessionId: string, revisionIds?: string[]) => this.snapshot(sessionId, undefined, { revisionIds }),
        apply: async (sessionId: string, input: import('../../../domain/mapping/agent/diagramEdit').DiagramRevisionApplication) => {
          const session = this.session(sessionId);
          return await this.bridge.dispatch(session.canvasId, { method: 'apply-diagram-revision', documentId: session.documentId, payload: input }) as { version: number; unresolvedEdgeIds: string[] };
        },
        create: async (sessionId: string, input: { requestId: string; expectedVersion: number; diagrams: import('../../../domain/mapping/agent/diagramEdit').DiagramCreation[] }) => {
          const session = this.session(sessionId);
          return await this.bridge.dispatch(session.canvasId, { method: 'create-diagrams', documentId: session.documentId, payload: input }) as { version: number };
        },
        batch: async (sessionId: string, input: DiagramBatchApplication) => {
          const session = this.session(sessionId);
          return await this.bridge.dispatch(session.canvasId, { method: 'apply-diagram-batch', documentId: session.documentId, payload: input }) as { version: number; unresolvedEdgeIds: string[] };
        }
      };
      this.edits = new DiagramEditService(editDiagrams, canvas, this.diagramContextStore);
      this.batches = new DiagramBatchService(editDiagrams, canvas, this.diagramContextStore, (sessionId, contextId) => {
        const session = this.session(sessionId);
        if (!this.agentContexts) throw Error('AGENT_CONTEXT_UNAVAILABLE');
        return this.agentContexts.get({ workspaceInstanceId: session.canvasId, documentId: session.documentId }, contextId);
      });
    }
  }
  dispose() { this.edits?.dispose(); this.batches?.dispose(); }
  async callBound(token: string, name: AgentToolName, raw: unknown) {
    const binding = this.chatBindings.capture(token), target = binding.target!;
    const input = { ...(raw as Record<string, unknown>) };
    const targeted = ['exec', 'draw_diagram', 'save_diagram', 'set_diagram_source_mappings', 'edit-diagram', 'create-diagram', 'extend-diagram', 'diagram-agent-context', 'canvas-view'];
    if (name === 'create_diagram_change_session' && !input.canvasId) input.canvasId = target.workspaceInstanceId;
    if ((targeted.includes(name) || name === 'diagram-search' && !input.representationId) && !input.changeSessionId) {
      if (!binding.attachment) binding.attachment = this.attach(target.workspaceInstanceId, target.documentId).then(result => result.sessionId)
        .catch(error => { binding.attachment = undefined; throw error; });
      const sessionId = await binding.attachment;
      if (input.sessionId && this.binding(input.sessionId as string) !== this.binding(sessionId)) throw Error('CHAT_BINDING_MISMATCH: use the canvas captured for this turn');
      input.sessionId = sessionId;
    }
    if (isDiagramTool(name)) return this.submitDirect(name, input, binding.readOnly);
    return this.call(name, input, binding.readOnly);
  }
  resolveDiagramArguments<T>(sessionId: string, raw: T): T {
    const input = this.aliases.resolve(raw, this.binding(sessionId));
    const walk = (value: unknown, key = ''): unknown => {
      if (typeof value === 'string' && (key === 'contentNodeId' || key === 'contentNodeIds')) return this.projection.resolveAnchorId(value);
      if (Array.isArray(value)) return value.map(item => walk(item, key));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
      return value;
    };
    return walk(input) as T;
  }
  async submitDirect(name: DiagramTool, raw: unknown, readOnly = false) {
    if (readOnly) throw Error('READ_ONLY: diagram submission requires Workspace access');
    if (!this.batches) throw Error('Diagram submission unavailable');
    const input = directBatchSchemas[name].parse(raw);
    this.session(input.sessionId);
    const resolved = this.resolveDiagramArguments(input.sessionId, input);
    const run = this.batches.start(resolved, name, true);
    return this.batches.wait(run.runId);
  }
  async call(name: AgentToolName, raw: unknown, readOnly = false): Promise<unknown> {
    if (readOnly && !['exec', 'canvas-api-search', 'diagram-search', 'diagram-agent-context', 'canvas-view', 'list_repositories', 'edit-diagram-status', 'get_repository_diff_hunks', 'read_change_session_diff_tree'].includes(name)) throw Error('READ_ONLY: canvas mutation requires Workspace access');
    const schema = agentToolSchemas[name];
    if (!schema) throw new Error('Unknown agent tool');
    const input = schema.parse(raw);
    if (name === 'canvas-view' && 'operation' in input && ['list', 'read'].includes(input.operation as string)) return this.execute(name, input, readOnly);
    if (name === 'diagram-agent-context' && 'operation' in input && input.operation === 'read') return this.execute(name, input, readOnly);
    if (name === 'edit-diagram' || name === 'create-diagram' || name === 'extend-diagram' || name === 'edit-diagram-status' || name === 'cancel-diagram-edit') {
      if (!this.edits) throw Error('Diagram editing UNAVAILABLE in this runtime');
      if (name === 'edit-diagram' || name === 'create-diagram' || name === 'extend-diagram') {
        const candidate = input as { sessionId: string };
        const edit = agentToolSchemas[name].parse(this.resolveDiagramArguments(candidate.sessionId, input));
        const session = this.session(edit.sessionId); // Live attachment only; never creates a proposal.
        if ('operations' in edit) {
          if (!this.batches) throw Error('Diagram batches unavailable');
          return this.batches.start(edit, name, false);
        }
        if (edit.agentContextId && !this.agentContexts) throw Error('AGENT_CONTEXT_UNAVAILABLE');
        const context = edit.agentContextId ? this.agentContexts!.get({ workspaceInstanceId: session.canvasId,
          documentId: session.documentId }, edit.agentContextId) : undefined;
        return this.edits.start(edit, context, name);
      }
      const { runId } = agentToolSchemas['edit-diagram-status'].parse(input);
      if (this.batches?.has(runId)) return name === 'edit-diagram-status' ? this.batches.get(runId) : this.batches.cancel(runId);
      return name === 'edit-diagram-status' ? this.edits.get(runId) : this.edits.cancel(runId);
    }
    if ('requestId' in input) {
      const key = `${readOnly}:${'changeSessionId' in input ? input.changeSessionId ?? '' : ''}:${name}:${'sessionId' in input ? input.sessionId ?? '' : ''}:${input.requestId}`;
      const signature = JSON.stringify(input), old = this.requests.get(key);
      if (old) { if (old.signature !== signature) throw new Error('REQUEST_ID_CONFLICT'); return old.promise; }
      if (name === 'exec') {
        const exec = input as ReturnType<typeof agentToolSchemas.exec.parse>;
        const pending = this.execRuns.get(JSON.stringify([exec.changeSessionId, exec.sessionId, exec.requestId]));
        if (pending && pending.signature !== signature) throw new Error('REQUEST_ID_CONFLICT');
      }
      if (this.requests.size >= 2000) throw new Error('Request capacity reached; restart the backend before a new session');
      const execute = () => this.execute(name, input, readOnly);
      const promise = ('changeSessionId' in input && input.changeSessionId && 'sessionId' in input && input.sessionId && name !== 'save_diagram'
        ? this.changeService().request(input.changeSessionId, `${name}:${input.requestId}`, signature, execute) : execute()).catch(error => {
        // The browser deduplicates request IDs too, so a lost acknowledgement can be recovered.
        if (canvasTimeout(error) || ['diagram-agent-context', 'canvas-view'].includes(name) && String(error).includes('PERSISTENCE_PENDING')) this.requests.delete(key);
        throw error;
      });
      this.requests.set(key, { signature, promise });
      // Pure exec reads have no mutation receipt to retain. Do not cache large read payloads.
      void promise.then(result => {
        if (name === 'exec' && result && typeof result === 'object' && 'version' in result && !('transaction' in result)) this.requests.delete(key);
      }, () => {});
      return promise;
    }
    return this.execute(name, input, readOnly);
  }
  private async execute(name: AgentToolName, raw: unknown, readOnly = false): Promise<unknown> {
    const candidate = raw as { sessionId?: string; changeSessionId?: string };
    if (candidate?.sessionId) raw = this.aliases.resolve(raw, this.binding(candidate.sessionId, candidate.changeSessionId));
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
    if (name === 'canvas-view') {
      const input = agentToolSchemas[name].parse(raw), session = this.session(input.sessionId);
      if (!['list', 'read'].includes(input.operation)) {
        if (readOnly) throw Error('READ_ONLY: CanvasView changes require Workspace access');
        if (input.expectedVersion === undefined) throw Error('expectedVersion is required for CanvasView changes');
      }
      return this.bridge.dispatch(session.canvasId, { method: 'canvas-view', documentId: session.documentId, payload: input });
    }
    if (name === 'diagram-agent-context') {
      const input = agentToolSchemas[name].parse(raw);
      if (readOnly && input.operation !== 'read') throw Error('READ_ONLY: canvas mutation requires Workspace access');
      const session = this.session(input.sessionId);
      const mutationKey = JSON.stringify([input.sessionId, input.requestId]);
      const prior = input.operation !== 'read' && this.diagramContextMutations.get(mutationKey);
      if (prior) {
        if (prior.signature !== JSON.stringify(input)) throw Error('REQUEST_ID_CONFLICT: diagram context arguments differ');
        return this.bridge.dispatch(prior.canvasId, { method: 'apply-diagram-context', documentId: prior.documentId, payload: prior.payload });
      }
      const snapshot = await this.snapshot(input.sessionId);
      const box = input.nodeId.startsWith('grid:') ? findBox(snapshot.document.scene.root, input.nodeId.slice(5)) : undefined;
      const diagram = box?.kind === 'diagram' ? snapshot.document.scene.contents[box.contentId] : undefined;
      if (!diagram) throw Error('Expected diagram GridBox');
      const bound = snapshot.document.diagramContexts?.[diagram.diagramId];
      if (input.operation === 'read') {
        const materialized = bound ? await loadDiagramAgentContext(bound, this.diagramContextStore) : undefined;
        return { diagramId: diagram.diagramId, revisionId: diagram.revisionId,
          version: snapshot.version, status: !bound ? 'absent' : bound.sourceFingerprint === diagramContextSourceFingerprint(diagram) ? 'ready' : 'stale',
          backingRecordId: bound?.backingRecordId ?? null,
          context: bound && materialized ? { diagramId: bound.diagramId, compiledFromRevisionId: bound.compiledFromRevisionId,
            sourceFingerprint: bound.sourceFingerprint, contentHash: materialized.contentHash, snapshot: materialized } : null };
      }
      if (input.expectedVersion === undefined || !input.expectedRevisionId) throw Error('Expected version and revision are required for context changes');
      if (snapshot.version !== input.expectedVersion || diagram.revisionId !== input.expectedRevisionId)
        throw Error('VERSION_CONFLICT: read the diagram again');
      if (input.operation === 'prepare' && !this.diagramContextStore) throw Error('AGENT_CONTEXT_STORAGE_UNAVAILABLE');
      const context = input.operation === 'prepare' ? await storeDiagramAgentContext(compileDiagramAgentContext(diagram), this.diagramContextStore!) : undefined;
      if (this.diagramContextMutations.size >= 500) throw Error('Diagram context request capacity reached');
      const payload = { operation: input.operation, requestId: input.requestId, expectedVersion: input.expectedVersion,
        expectedRevisionId: input.expectedRevisionId, nodeId: input.nodeId, diagramId: diagram.diagramId, ...(context ? { context } : {}) };
      this.diagramContextMutations.set(mutationKey, { signature: JSON.stringify(input), canvasId: session.canvasId, documentId: session.documentId, payload });
      return this.bridge.dispatch(session.canvasId, { method: 'apply-diagram-context', documentId: session.documentId, payload });
    }
    if (name === 'exec') return this.exec(agentToolSchemas[name].parse(raw), readOnly);
    if (name === 'save_diagram') return this.save(agentToolSchemas[name].parse(raw));
    if (name === 'set_diagram_source_mappings') {
      const { sessionId, changeSessionId, expectedVersion, requestId, ...fields } = agentToolSchemas[name].parse(raw);
      return this.projection.result(await this.apply(sessionId, expectedVersion, [{ method: 'setSourceMappings', ...fields, expectedContentHash: await this.mappingHash(sessionId, changeSessionId, fields.nodeId, expectedVersion) }], requestId, changeSessionId) as EditResult);
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
  private binding(sessionId: string, changeSessionId?: string) {
    const session = this.session(sessionId, changeSessionId);
    return JSON.stringify([session.canvasId, session.documentId, changeSessionId]);
  }
  private async snapshot(sessionId: string, changeSessionId?: string, options?: { revisionIds?: string[]; currentRevisions?: boolean }): Promise<LiveDocumentSnapshot> {
    const session = this.session(sessionId, changeSessionId);
    if (session.changeSessionId) return this.changeService().snapshot(session.changeSessionId, session.documentId);
    return await this.bridge.dispatch(session.canvasId, { method: 'snapshot', documentId: session.documentId, payload: options }) as LiveDocumentSnapshot;
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
      const snapshot = changeSessionId ? await this.snapshot(sessionId, changeSessionId) : await this.bridge.dispatch(canvasId, { method: 'identity', documentId }) as LiveDocumentSnapshot;
      return { sessionId, canvasId, documentId, changeSessionId, repositoryId: snapshot.repositoryId, version: snapshot.version };
    } catch (error) { this.sessions.delete(sessionId); throw error; }
  }
  private async mappingHash(sessionId: string, changeSessionId: string | undefined, nodeId: string, version: number) {
    const snapshot = await this.snapshot(sessionId, changeSessionId);
    if (snapshot.version !== version) throw Error('VERSION_CONFLICT: read the canvas again');
    const box = nodeId.startsWith('grid:') && findBox(snapshot.document.scene.root, nodeId.slice(5));
    if (!box || box.kind !== 'diagram') throw Error('Expected diagram GridBox');
    return snapshot.document.scene.contents[box.contentId].content.asciiSha256;
  }
  private async apply(sessionId: string, expectedVersion: number, operations: DiagramOperation[], requestId: string, changeSessionId?: string) {
    const session = this.session(sessionId, changeSessionId);
    if (session.changeSessionId) return this.changeService().apply(session.changeSessionId, session.documentId, expectedVersion, operations, requestId);
    return this.bridge.dispatch(session.canvasId, { method: 'apply', documentId: session.documentId, payload: { expectedVersion, operations, requestId, resultNodeIds: operations.flatMap(op => 'nodeId' in op ? [op.nodeId] : op.method === 'diagram-create' ? [`grid:${op.id}`] : []) } });
  }
  private async applyBatch(sessionId: string, expectedVersion: number, operations: DiagramOperation[], requestId: string, changeSessionId?: string): Promise<CanvasMutationResult> {
    const session = this.session(sessionId, changeSessionId);
    if (session.changeSessionId) {
      const result = await this.changeService().apply(session.changeSessionId, session.documentId, expectedVersion, operations, requestId);
      return canvasMutationResult(session.documentId, operations, result);
    }
    return await this.bridge.dispatch(session.canvasId, { method: 'apply', documentId: session.documentId,
      payload: { expectedVersion, operations, requestId, resultFormat: 'receipt' } }) as CanvasMutationResult;
  }
  private async exec(input: ReturnType<typeof agentToolSchemas.exec.parse>, readOnly = false) {
    const key = JSON.stringify([input.changeSessionId, input.sessionId, input.requestId]);
    const signature = JSON.stringify(input);
    let run = this.execRuns.get(key);
    if (run && run.signature !== signature) throw new Error('REQUEST_ID_CONFLICT');
    if (!run) {
      if (this.execRuns.size >= 2000) throw new Error('Execution retry capacity reached');
      const session = input.sessionId && this.session(input.sessionId, input.changeSessionId);
      const snapshot = session ? (input.changeSessionId ? await this.snapshot(input.sessionId!, input.changeSessionId)
        : await this.bridge.dispatch(session.canvasId, { method: 'identity', documentId: session.documentId }) as LiveDocumentSnapshot) : undefined;
      run = { signature, initialVersion: snapshot?.version, version: snapshot?.version, createdDocument: false, steps: [], batches: new Map(),
        nodes: snapshot?.document && canvasDisplayNodes(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds),
        edges: snapshot?.document?.edges };
      this.execRuns.set(key, run);
    }
    const state = run;
    // A retry replays completed API results and resends only an unacknowledged call.
    // The pending call retains its operation ID, expected version and request ID.
    const requestPrefix = `exec-${createHash('sha256').update(key).digest('hex')}`;
    let cursor = 0;
    let pending: number[] = [];
    let uncertain = false;
    const flush = async () => {
      if (uncertain) throw Error('CANVAS_TIMEOUT: retry execution with the same requestId');
      if (!pending.length) return;
      const indices = pending; pending = [];
      const first = indices[0];
      let batch = state.batches.get(first);
      if (!batch) {
        batch = { indices, expectedVersion: state.version! };
        state.batches.set(first, batch);
      }
      if (JSON.stringify(batch.indices) !== JSON.stringify(indices)) throw Error('REQUEST_ID_CONFLICT: batch changed during retry');
      if (batch.error) throw batch.error;
      if (!batch.result) {
        try {
          batch.result = await this.applyBatch(input.sessionId!, batch.expectedVersion,
            indices.map(index => state.steps[index].operation!), `${requestPrefix}:batch:${first}`, input.changeSessionId);
          state.version = batch.result.version; state.nodes = undefined; state.edges = undefined;
        } catch (error) {
          if (canvasTimeout(error)) uncertain = true;
          else batch.error = error;
          throw error;
        }
      }
    };
    try {
      const value = await this.runtime.run(input.code, async (method, args) => {
        if (readOnly && !['canvas.read', 'canvas.list', 'canvas.attach', 'nodes.list', 'nodes.get', 'nodes.variants', 'nodes.alternatives', 'edges.list'].includes(method)) throw Error('READ_ONLY: canvas mutation requires Workspace access');
        if (input.mode === 'batched' && (method.startsWith('canvas.') || ['nodes.list', 'nodes.get', 'nodes.variants', 'nodes.alternatives', 'edges.list', 'nodes.setSourceMappings', 'nodes.setJumps'].includes(method))) await flush();
        if (uncertain) throw Error('CANVAS_TIMEOUT: retry execution with the same requestId');
        const stepIndex = cursor++, stepSignature = JSON.stringify({ method, args });
        let step = state.steps[stepIndex];
        if (step && step.signature !== stepSignature) throw new Error('REQUEST_ID_CONFLICT: execution changed during retry');
        if (!step) {
          try {
            const entry = canvasMethods[method as keyof typeof canvasMethods];
            if (!entry) throw new Error('Unknown canvas method');
            const resolved = input.sessionId ? this.aliases.resolve(args, this.binding(input.sessionId, input.changeSessionId)) : args;
            const parsed = entry.schema.parse(resolved) as Record<string, any>;
            let execute: () => Promise<unknown>;
            let queuedOperation: DiagramOperation | undefined;
            if (method === 'canvas.list') execute = async () => input.changeSessionId ? this.changeService().descriptor(input.changeSessionId) : this.bridge.list();
            else if (method === 'canvas.attach') {
              if (input.sessionId) {
                const bound = this.session(input.sessionId, input.changeSessionId);
                if (parsed.canvasId !== bound.canvasId || parsed.documentId !== bound.documentId) throw Error('BINDING_MISMATCH: use an unbound execution to attach elsewhere');
              }
              execute = () => this.attach(parsed.canvasId, parsed.documentId, input.changeSessionId);
            }
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
              if (['nodes.list', 'nodes.get', 'nodes.setJumps'].includes(method) && !state.nodes) {
                const snapshot = await this.snapshot(sessionId, input.changeSessionId);
                if (snapshot.version !== state.version) throw Error('VERSION_CONFLICT: canvas changed during execution');
                state.nodes = canvasDisplayNodes(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds);
                state.edges = snapshot.document.edges;
              }
              if (method === 'canvas.read') execute = async () => {
                const session = this.session(sessionId, input.changeSessionId);
                const read = input.changeSessionId ? currentCanvasRead(await this.snapshot(sessionId, input.changeSessionId), parsed as { level: 'small' | 'full'; nodeIds?: string[] })
                  : await this.bridge.dispatch(session.canvasId, { method: 'read', documentId: session.documentId, payload: parsed }) as object;
                return this.aliases.project(read, this.binding(sessionId, input.changeSessionId));
              };
              else if (method === 'edges.list') execute = async () => {
                if (!state.edges) {
                  const snapshot = await this.snapshot(sessionId, input.changeSessionId);
                  if (snapshot.version !== state.version) throw new Error('VERSION_CONFLICT: canvas changed during execution');
                  state.edges = snapshot.document.edges;
                }
                return { version: state.version, edges: state.edges.map(edge => this.projection.edge(edge)) };
              };
              else if (method === 'nodes.alternatives') execute = async () => {
                const snapshot = await this.snapshot(sessionId, input.changeSessionId);
                if (snapshot.version !== state.version) throw Error('VERSION_CONFLICT: canvas changed during execution');
                const alternatives = snapshot.document.alternatives;
                return { version: state.version, alternatives: Object.values(alternatives?.items ?? {}).filter(item => item.presentationId === parsed.nodeId),
                  selected: alternatives?.selected[parsed.nodeId] ?? [], panels: Object.values(alternatives?.panels ?? {}).filter(panel => panel.attachment.diagramPresentationId === parsed.nodeId) };
              };
              else if (method === 'nodes.variants') execute = async () => {
                const snapshot = await this.snapshot(sessionId, input.changeSessionId);
                if (snapshot.version !== state.version) throw Error('VERSION_CONFLICT: canvas changed during execution');
                const node = canvasDisplayNodes(snapshot.document, snapshot.canvas, snapshot.version).find(node => node.id === parsed.nodeId);
                if (node?.layout !== 'grid' || !node.diagram) throw Error('Expected diagram');
                const variants = Object.values(snapshot.document.revisionReviews ?? {}).filter(variant => variant.contentId === node.diagram!.id);
                const retained = await this.snapshot(sessionId, input.changeSessionId, { revisionIds: variants.flatMap(reviewRevisionIds) });
                if (retained.version !== state.version) throw Error('VERSION_CONFLICT: canvas changed during execution');
                const revisions = retained.history?.diagramRevisions ?? Object.fromEntries((retained.revisions ?? []).map(revision => [revision.id, revision]));
                return { version: state.version, variants: variants.map(variant => ({ variant, ...reviewRevision(variant, id => revisions[id]) })) };
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
                if ((method === 'nodes.collapse' || method === 'nodes.highlight') && parsed.contentNodeId) parsed.contentNodeId = this.projection.resolveAnchorId(parsed.contentNodeId);
                if (method === 'nodes.highlight') {
                  parsed.highlightId = `highlight-${randomUUID()}`;
                  if (parsed.contentNodeIds) parsed.contentNodeIds = parsed.contentNodeIds.map((id: string) => this.projection.resolveAnchorId(id));
                }
                if (method === 'nodes.setPresentation' && parsed.settings.highlights) {
                  parsed.settings.highlights = parsed.settings.highlights.map((item: any) => ({ ...item,
                    ...(item.contentNodeId ? { contentNodeId: this.projection.resolveAnchorId(item.contentNodeId) } : {}),
                    ...(item.contentNodeIds ? { contentNodeIds: item.contentNodeIds.map((id: string) => this.projection.resolveAnchorId(id)) } : {}) }));
                }
                if (method === 'nodes.setSourceMappings') parsed.expectedContentHash = await this.mappingHash(sessionId, input.changeSessionId, parsed.nodeId, state.version);
                if (method === 'nodes.setJumps') {
                  const node = state.nodes!.find(node => node.id === parsed.nodeId);
                  if (node?.layout !== 'grid' || !node.diagram) throw Error('Expected diagram GridBox');
                  const diagram = node.diagram;
                  parsed.jumps = parsed.jumps.map(({ status: _status, ...jump }: any) => {
                    const old = diagram.jumps?.find(j => j.id === jump.id && j.source.revisionId === jump.source.revisionId);
                    const contentHash = jump.source.contentHash ?? (jump.source.revisionId === diagram.content.revisionId ? diagram.content.asciiSha256 : old?.source.contentHash);
                    if (!contentHash) throw Error('STALE_JUMP_SOURCE: read current jump metadata');
                    return { ...jump, source: { ...jump.source, contentHash } };
                  });
                  parsed.jumps = await this.resolveJumps(parsed.jumps, diagram.jumps);
                }
                const expectedVersion = state.version;
                const operation = (method.startsWith('edges.')
                  ? method === 'edges.remove' ? { method: 'edge-remove', edgeId: parsed.edgeId }
                    : { method: method === 'edges.create' ? 'edge-create' : 'edge-update',
                        edge: { ...parsed, id: method === 'edges.create' ? `connection-${randomUUID()}` : parsed.id } }
                  : method === 'nodes.promoteAlternative' ? { ...parsed, method: 'alternative-promote' }
                  : method === 'nodes.selectAlternative' ? { ...parsed, method: 'alternative-select' }
                  : method === 'nodes.removeAlternative' ? { ...parsed, method: 'alternative-remove' }
                  : method === 'nodes.sidePanel' ? { ...parsed, method: 'side-panel' }
                  : method === 'nodes.selectRevision' ? { ...parsed, method: 'revision-select' }
                  : method === 'nodes.reviewVariant' ? { ...parsed, method: 'variant-review' }
                  : method === 'nodes.draw' ? { ...parsed, method: 'diagram-create', id: `diagram-${randomUUID()}` }
                    : { ...parsed, method: method.slice(6) }) as DiagramOperation;
                if (input.mode === 'batched') {
                  queuedOperation = operation;
                  // IDs support dependent writes without pretending a queued mutation has committed.
                  const handle = 'edge' in operation ? { id: operation.edge.id, edgeId: operation.edge.id }
                    : 'edgeId' in operation ? { id: operation.edgeId, edgeId: operation.edgeId }
                    : { id: operation.method === 'diagram-create' ? `grid:${operation.id}` : parsed.nodeId,
                        nodeId: operation.method === 'diagram-create' ? `grid:${operation.id}` : parsed.nodeId };
                  execute = async () => ({ ...handle, status: 'queued' });
                } else execute = async () => {
                  const result = await this.apply(sessionId, expectedVersion, [operation], `${requestPrefix}:${stepIndex}`, input.changeSessionId) as EditResult;
                  state.version = result.version; state.nodes = undefined; state.edges = undefined; state.lastEdit = result;
                  if (method.startsWith('edges.')) return 'edge' in operation ? this.projection.edge(operation.edge) : null;
                  const nodeId = operation.method === 'diagram-create' ? `grid:${operation.id}` : parsed.nodeId;
                  const node = result.nodes.find(node => node.id === nodeId);
                  return node ? this.projection.node(node) : null;
                };
              }
            }
            step = { signature: stepSignature, execute, operation: queuedOperation };
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
        if (step.operation) pending.push(stepIndex);
        return step.outcome.value;
      });
      await flush();
      // A script may catch a transport timeout. Keep it retryable until the unknown
      // outcome is acknowledged, rather than reporting a completed execution.
      if (state.steps.some(step => !step.outcome)) throw new Error('CANVAS_TIMEOUT: retry execution with the same requestId');
      this.execRuns.delete(key);
      if (state.batches.size) return { value, transaction: { version: state.version,
        receipts: [...state.batches.values()].flatMap(batch => batch.result?.receipts ?? []) } };
      return state.lastEdit ? { value, transaction: this.projection.result(state.lastEdit) } : { value, ...(state.version === undefined ? {} : { version: state.version }) };
    } catch (error) {
      if (uncertain) throw Error('CANVAS_TIMEOUT: retry execution with the same requestId');
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
        catalog = await (this.store.projectCatalogs.loadCurrentRepresentationCatalog?.(project.id) ?? this.store.projectCatalogs.loadRepresentationCatalog(project.id));
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
    const catalog = await (this.store.projectCatalogs.loadCurrentRepresentationCatalog?.(project.id, input.revisionId ? [input.revisionId] : undefined) ?? this.store.projectCatalogs.loadRepresentationCatalog(project.id));
    const representations = Object.values(catalog.representations).filter(rep => rep.status === 'settled' && (!input.representationId || rep.id === input.representationId));
    if (input.operation === 'read') {
      const representation = representations.find(rep => rep.id === input.representationId);
      if (!representation) throw new Error('A valid representationId is required');
      const revisionId = input.revisionId ?? representation.currentRevisionId;
      if (!representation.revisionIds.includes(revisionId)) throw new Error('Revision does not belong to representation');
      const revision = catalog.revisions[revisionId];
      const document = documentFromRevision(revision);
      return { origin: 'saved', representation, revision: { id: revision.id, ascii: revision.ascii, revision: revision.revision, createdAt: revision.createdAt, representationKind: revision.representationKind }, nodes: this.projection.nodes(canvasDisplayNodes(document, initialCanvasState(), 0)) };
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
    const session = this.session(input.sessionId);
    if (!input.nodeId) {
      const checkpoint = await this.bridge.dispatch(session.canvasId, { method: 'checkpoint', documentId: session.documentId,
        payload: { expectedVersion: input.expectedVersion, requestId: input.requestId } }) as { checkpointId: string; representationId?: string; revisionId?: string; repositoryId?: string };
      const receipt = await this.diagrams.publishCheckpoint({ documentId: session.documentId, checkpointId: checkpoint.checkpointId,
        expectedVersion: input.expectedVersion, requestId: input.requestId, name: input.name, repositoryId: input.repositoryId ?? checkpoint.repositoryId,
        representationId: input.representationId ?? checkpoint.representationId, expectedRevisionId: input.expectedRevisionId ?? checkpoint.revisionId });
      let displayUpdated = true;
      try { await this.bridge.dispatch(session.canvasId, { method: 'saved', documentId: session.documentId, payload: { receipt, requestId: input.requestId, name: input.name } }); }
      catch { displayUpdated = false; }
      return { representationId: receipt.representation.id, revisionId: receipt.revisionId, savedVersion: receipt.savedVersion, version: receipt.savedVersion, displayUpdated };
    }
    const snapshot = await this.snapshot(input.sessionId, input.changeSessionId);
    if (input.expectedVersion !== snapshot.version) throw new Error('VERSION_CONFLICT: read the canvas again');
    let scene = snapshot.document.scene, history = snapshot.history;
    if (input.nodeId) {
      const node = canvasDisplayNodes(snapshot.document, snapshot.canvas, snapshot.version, snapshot.cell, snapshot.endpointBounds).find(node => node.id === input.nodeId);
      if (!node || node.layout !== 'grid' || node.kind !== 'diagram') throw new Error('Expected diagram GridBox');
      const box = findBox(scene.root, node.boxId)!;
      if (box.kind !== 'diagram') throw new Error('Expected diagram');
      const content = scene.contents[box.contentId];
      const isolated = singleDiagramScene(content.content.ascii);
      scene = { ...isolated, contents: { ...isolated.contents, overview: createStoredDiagram({id:'overview', revision:content.revision, ascii:content.content.ascii, structureKind:content.content.structure.kind, source:content.sourceContext.binding, evidence:content.sourceContext.evidence, mappings:content.sourceContext.mappings}).diagram } };
      if (content.jumps) scene = { ...scene, contents: { ...scene.contents, overview: reviseStoredDiagram(scene.contents.overview.revisionId, { kind: 'jumps', jumps: rebaseDiagramJumps(content.content, scene.contents.overview.content, content.jumps) }).diagram } };
      const settings = snapshot.document.diagramPresentations?.[box.contentId];
      const originalHighlights = presentationHighlights(content, settings, getDiagramRevision(content.revisionId).nodeRefs);
      const output = scene.contents.overview, refs = getDiagramRevision(output.revisionId).nodeRefs;
      const highlights = rebaseDiagramHighlights(originalHighlights, correspondingNodes(content, output)).map(item => ({ ...item,
        nodeRefs: (item.contentNodeIds ?? (item.contentNodeId ? [item.contentNodeId] : [])).map(id => refs[id] ?? `stale:${id}`),
        ...(item.textRange && item.revisionId === content.revisionId ? { revisionId: output.revisionId } : {}) }));
      const histories = new DefaultCanvasHistoryService();
      history = histories.exportContext(histories.openContext({ scene, edges: [], sections: {}, ...(settings || highlights.length ? { diagramPresentations: { overview: { ...settings, highlights } } } : {}) }, snapshot.canvas));
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
