import { selectionExcerpt } from '../../../domain/mapping/workspace/selectionClipboard';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { diagramSubtreeRange } from '../../../domain/core/diagrams/diagramSubtreeEdit';
import { validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { AgentContext, type AgentContextSnapshot } from '../../../domain/core/agents/agentContext';
import { randomUUID } from 'node:crypto';
import { CanvasHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import type { DiagramService, DiagramRevisionResult, DiagramRevision } from '../../../domain/core/diagrams/diagramService';
import type { GridBox } from '../../../domain/core/diagrams/lineGrid';
import type { LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import type { CreateDiagramInput, DiagramCreation, DiagramEditRun, DiagramRevisionApplication, EditDiagramInput, PromptReference } from '../../../domain/mapping/agent/diagramEdit';
import { defaultTemplateSelection, resolvePromptTemplate, type PromptOperation } from '../../../domain/mapping/agent/promptTemplates';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import { diagramSelectionNodes } from '../../../domain/mapping/workspace/mappingDocument';

export interface DiagramEditCanvasPort {
  snapshot(sessionId: string): Promise<LiveDocumentSnapshot>;
  apply(sessionId: string, input: DiagramRevisionApplication): Promise<{ version: number; unresolvedEdgeIds: string[] }>;
  /** Idempotent per requestId. Optional: runtimes without it reject create-diagram. */
  create?(sessionId: string, input: { requestId: string; expectedVersion: number; diagrams: DiagramCreation[] }): Promise<{ version: number }>;
}
interface Run {
  agentContext?: AgentContextSnapshot;
  nextAgentContext?: AgentContextSnapshot;
  input: CreateDiagramInput;
  signature: string;
  state: DiagramEditRun;
  abort: AbortController;
  revision?: DiagramRevisionResult;
  created?: DiagramRevisionResult[];
  pending?: Promise<void>;
}
/** A reference as the model receives it: the pinned revision's text, never the live canvas. */
export type ResolvedPromptReference = { ref: number; kind: PromptReference['kind']; label: string; diagramId: string; revisionId: string }
  & ({ kind: 'diagram'; ascii: string } | { kind: 'nodes'; range: Extract<PromptReference, { kind: 'nodes' }>['range']; excerpt: string; nodes: { id: string; label: string }[] });

/** A request owns both generation and installation; retries never rerun the model. */
export class DiagramEditService {
  private runs = new Map<string, Run>();
  private requests = new Map<string, string>();
  constructor(private readonly diagrams: DiagramService, private readonly canvas: DiagramEditCanvasPort) {}

  start(input: EditDiagramInput | CreateDiagramInput, suppliedContext?: AgentContextSnapshot, operation: PromptOperation = 'edit-diagram'): DiagramEditRun {
    if (input.agentContext && (input.agentContextId || suppliedContext)) throw Error('Provide only one agent context source');
    if (input.agentContext && !input.llmSessionId) throw Error('Panel context requires llmSessionId');
    const rawContext = input.agentContext ?? suppliedContext;
    const agentContext = rawContext ? AgentContext.fromSnapshot(rawContext).toSnapshot() : undefined;
    if (input.llmSessionId && agentContext && agentContext.source.sourceSessionId !== input.llmSessionId)
      throw Error('AGENT_CONTEXT_SESSION_MISMATCH: context belongs to another panel');
    if (input.agentContextId && !agentContext) throw Error('AGENT_CONTEXT_NOT_FOUND: resolve context before starting the edit');
    if (operation !== 'edit-diagram' && !this.canvas.create) throw Error('Diagram creation UNAVAILABLE in this runtime');
    if (operation === 'edit-diagram' && 'count' in input && input.count !== undefined) throw Error('count applies only to create-diagram');
    if (operation === 'extend-diagram' && (!input.origin || !input.sources?.length)) throw Error('Extend requires a selection and a canvas origin');
    // Fail fast on an unknown template or invalid options instead of after a model call.
    resolvePromptTemplate(input.template ?? defaultTemplateSelection(operation), operation);
    const key = JSON.stringify([input.sessionId, input.requestId]);
    const signature = JSON.stringify({ operation, input, agentContextHash: agentContext?.contentHash });
    const existing = this.requests.get(key);
    if (existing) {
      const run = this.runs.get(existing)!;
      if (run.signature !== signature) throw Error('REQUEST_ID_CONFLICT: edit request differs');
      if (run.state.status === 'awaiting-acknowledgement' && !run.pending) this.launch(run, () => this.install(run));
      return structuredClone(run.state);
    }
    if (this.runs.size >= 500) throw Error('Diagram edit run capacity reached; restart the backend');
    const run: Run = { agentContext, input: structuredClone(input), signature, abort: new AbortController(), state: {
      runId: `diagram-edit-${randomUUID()}`, operation, status: 'generating', nodeId: input.nodeId, baseRevisionId: input.baseRevisionId
    } };
    this.runs.set(run.state.runId, run); this.requests.set(key, run.state.runId);
    this.launch(run, () => this.generate(run));
    return structuredClone(run.state);
  }
  get(id: string) {
    const run = this.runs.get(id); if (!run) throw Error('Diagram edit run not found');
    return structuredClone(run.state);
  }
  cancel(id: string) {
    const run = this.runs.get(id); if (!run) throw Error('Diagram edit run not found');
    // Once application is dispatched its outcome can be unknown. Never call it cancelled.
    if (run.state.status === 'generating') {
      run.abort.abort(); run.state.status = 'cancelled'; run.state.message = 'Cancelled before application';
    }
    return structuredClone(run.state);
  }
  private launch(run: Run, work: () => Promise<void>) {
    run.pending = work().catch(error => {
      if (run.abort.signal.aborted && run.state.status !== 'applying') { run.state.status = 'cancelled'; return; }
      const message = error instanceof Error ? error.message : String(error);
      run.state.status = run.state.status === 'applying' && /CANVAS_TIMEOUT|CANVAS_UNAVAILABLE|PERSISTENCE_PENDING/.test(message)
        ? 'awaiting-acknowledgement' : message.includes('VERSION_CONFLICT') ? 'conflict' : 'failed';
      run.state.error = message;
    }).finally(() => { run.pending = undefined; });
  }
  private install(run: Run) { return run.state.operation !== 'edit-diagram' ? this.place(run) : this.apply(run); }
  private async generate(run: Run) {
    const { input, abort } = run, operation = run.state.operation;
    const snapshot = await this.canvas.snapshot(input.sessionId);
    abort.signal.throwIfAborted();
    if (snapshot.version !== input.expectedVersion) throw Error('VERSION_CONFLICT: read the canvas again');
    const box = input.nodeId.startsWith('grid:') && findBox(snapshot.document.scene.root, input.nodeId.slice(5));
    const unanchored = operation === 'create-diagram' && input.nodeId === 'canvas';
    if (!unanchored && (!box || box.kind !== 'diagram')) throw Error('Expected diagram GridBox');
    const base = box && box.kind === 'diagram' ? snapshot.document.scene.contents[box.contentId]
      : this.diagrams.create({ id: `context-${randomUUID()}`, revision: 0, ascii: '[New diagram]' }).diagram;
    if (!unanchored && base.revisionId !== input.baseRevisionId) throw Error('VERSION_CONFLICT: diagram base is no longer current');
    if (!snapshot.history) throw Error('Canvas history is required for diagram generation');
    // Validated portable history imports the exact browser-issued revision identities.
    new CanvasHistory(snapshot.document, snapshot.canvas, snapshot.history, 'current');
    const template = resolvePromptTemplate(input.template ?? defaultTemplateSelection(operation), operation);
    const references = this.resolveReferences(input.references ?? [], snapshot.history);
    const lines = base.content.ascii.split('\n');
    if (input.subtree && input.subtree.revisionId !== base.content.revisionId) throw Error('VERSION_CONFLICT: selected subtree changed; select it again');
    const editRange = operation === 'edit-diagram' && input.subtree ? diagramSubtreeRange(base, input.subtree.contentNodeId) : undefined;
    if (operation === 'extend-diagram') for (const source of input.sources!) validateConnectionAnchor(snapshot.document.scene, source);
    const request = { editRange, instruction: input.prompt, agentContext: run.agentContext, llmSessionId: input.llmSessionId,
      prompt: { markdown: template.markdown, options: template.options, parameters: template.definition.parameters, references },
      context: { diagram: base, selection: { startLine: 1, endLine: lines.length, startColumn: 1,
        endColumn: Math.max(1, ...lines.map(line => line.length)) }, connections: snapshot.document.edges } };
    const options = { signal: abort.signal, onAgentSession: (id: string) => { run.state.agentSessionId = id; },
      onAgentContext: (context: AgentContextSnapshot) => {
        const next = AgentContext.fromSnapshot(context).toSnapshot();
        if (next.source.sourceSessionId !== input.llmSessionId) throw Error('AGENT_CONTEXT_SESSION_MISMATCH');
        run.nextAgentContext = next;
      }, onProgress: (message: string) => { if (run.state.status === 'generating') run.state.message = message; } };
    if (operation !== 'edit-diagram') {
      run.created = [];
      for (let index = 0; index < (operation === 'extend-diagram' ? 1 : input.count ?? 1); index++) {
        if (input.count && input.count > 1) options.onProgress(`Generating diagram ${index + 1} of ${input.count}…`);
        run.created.push(await this.diagrams.generate({ ...request, agentContext: run.nextAgentContext ?? run.agentContext, input: { id: `diagram-${randomUUID()}`, structureKind: base.content.structure.kind,
          source: base.sourceContext.binding, evidence: base.sourceContext.evidence } }, options));
        abort.signal.throwIfAborted();
      }
      await this.place(run);
      return;
    }
    run.revision = await this.diagrams.generate({ ...request, baseRevisionId: base.revisionId, input: { id: base.id,
      structureKind: base.content.structure.kind, source: base.sourceContext.binding, evidence: base.sourceContext.evidence } }, options);
    abort.signal.throwIfAborted();
    run.state.generated = { diagramId: run.revision.diagram.diagramId, revisionId: run.revision.revision.id,
      ascii: run.revision.diagram.content.ascii };
    await this.apply(run);
  }
  /** References resolve against the canvas's own revision history first; the service registry covers revisions it issued. */
  private resolveReferences(references: readonly PromptReference[], history: CanvasHistoryRecord): ResolvedPromptReference[] {
    return references.map((reference, index) => {
      const ref = index + 1;
      let revision: DiagramRevision | undefined = history.diagramRevisions[reference.revisionId];
      if (!revision) try { revision = this.diagrams.getRevision(reference.revisionId); } catch { /* reported below */ }
      if (!revision || revision.diagramId !== reference.diagramId) throw Error(`PROMPT_REFERENCE_NOT_FOUND: [ref ${ref}] ${reference.label} is not available`);
      const common = { ref, label: reference.label, diagramId: reference.diagramId, revisionId: reference.revisionId };
      if (reference.kind === 'diagram') return { ...common, kind: 'diagram', ascii: revision.diagram.content.ascii };
      const lines = revision.diagram.content.ascii.split('\n'), range = reference.range;
      if (range.endLine > lines.length) throw Error(`PROMPT_REFERENCE_INVALID: [ref ${ref}] range is outside its revision`);
      const known = new Map([...diagramSelectionNodes(revision.diagram), ...diagramContentNodes(revision.diagram.content)].map(node => [node.id, node.label]));
      const unknown = reference.nodeIds.find(id => !known.has(id));
      if (unknown) throw Error(`PROMPT_REFERENCE_INVALID: [ref ${ref}] node ${unknown} is not in its revision`);
      return { ...common, kind: 'nodes', range,
        excerpt: reference.nodeIds.length && reference.nodeIds.every(id => diagramContentNodes(revision.diagram.content).some(node => node.id === id))
          ? selectionExcerpt(revision.diagram, range, reference.nodeIds)
          : lines.slice(range.startLine - 1, range.endLine).map(line => line.slice(range.startColumn - 1, range.endColumn).trimEnd()).join('\n'),
        nodes: reference.nodeIds.map(id => ({ id, label: known.get(id)! })) };
    });
  }
  private async apply(run: Run) {
    run.state.status = 'applying'; delete run.state.error;
    const revision = run.revision!.revision, input = run.input;
    // The controller checks both versions at the mutation boundary, after generation.
    const result = await this.canvas.apply(input.sessionId, { requestId: run.state.runId,
      expectedVersion: input.expectedVersion, nodeId: input.nodeId, baseRevisionId: input.baseRevisionId, revision });
    run.state.result = { diagramId: revision.diagramId, previousRevisionId: input.baseRevisionId,
      revisionId: revision.id, documentVersion: result.version, unresolvedEdgeIds: result.unresolvedEdgeIds };
    run.state.agentContext = run.nextAgentContext;
    run.state.status = 'completed'; run.state.message = 'Diagram revision installed and workspace persisted';
  }
  /** New diagrams never conflict with canvas edits: placement reads the latest version and sits beside the anchor. */
  private async place(run: Run) {
    run.state.status = 'applying'; delete run.state.error;
    for (let attempt = 1; ; attempt++) {
      try { return await this.placeOnce(run); }
      catch (error) { if (attempt >= 3 || !String(error).includes('VERSION_CONFLICT')) throw error; }
    }
  }
  private async placeOnce(run: Run) {
    const snapshot = await this.canvas.snapshot(run.input.sessionId);
    if (run.state.operation === 'extend-diagram') for (const source of run.input.sources!) validateConnectionAnchor(snapshot.document.scene, source);
    const anchorId = run.input.nodeId.slice(5), parent = findParent(snapshot.document.scene.root, anchorId);
    const anchor = parent?.children.find(child => child.id === anchorId);
    const width = (ascii: string) => Math.max(1, ...ascii.split('\n').map(line => line.length)) + 2;
    let column = anchor ? anchor.position.column + width(anchor.kind === 'diagram' ? snapshot.document.scene.contents[anchor.contentId]?.content.ascii ?? '' : '') + 4 : 0;
    const diagrams = run.created!.map(created => {
      const { diagram } = created, position = run.input.origin ?? { column, row: anchor?.position.row ?? 0 };
      column += width(diagram.content.ascii) + 4;
      return { id: diagram.id, position, ...(run.state.operation === 'extend-diagram' ? { sources: run.input.sources } : {}), ...(run.input.origin ? {} : parent && parent.id !== snapshot.document.scene.root.id ? { parentId: `grid:${parent.id}` } : {}),
        content: { ascii: diagram.content.ascii, structureKind: diagram.content.structure.kind, mappings: diagram.sourceContext.mappings,
          evidence: diagram.sourceContext.evidence, source: diagram.sourceContext.binding } } as DiagramCreation;
    });
    const result = await this.canvas.create!(run.input.sessionId, { requestId: run.state.runId, expectedVersion: snapshot.version, diagrams });
    run.state.created = { documentVersion: result.version, nodeIds: diagrams.map(diagram => `grid:${diagram.id}`) };
    run.state.agentContext = run.nextAgentContext;
    run.state.status = 'completed'; run.state.message = `${diagrams.length === 1 ? 'Diagram' : `${diagrams.length} diagrams`} created beside the anchor`;
  }
  dispose() { for (const run of this.runs.values()) this.cancel(run.state.runId); }
}

function findParent(box: GridBox, id: string): Extract<GridBox, { kind: 'container' }> | undefined {
  if (box.kind !== 'container') return undefined;
  return box.children.some(child => child.id === id) ? box : box.children.map(child => findParent(child, id)).find(Boolean);
}
