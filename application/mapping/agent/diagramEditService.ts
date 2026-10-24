import { generateDiagram } from '../../core/diagrams/generateDiagram';
import { createStoredDiagram, importDiagramRevision, getDiagramRevision, submitStoredDiagramEdit } from '../../../domain/core/diagrams/diagramRevisionStore';
import type { GeneratedDiagramEdit } from '../../../domain/core/diagrams/generatedDiagramEdit';
import { selectionExcerpt } from '../../../domain/mapping/workspace/selectionClipboard';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { diagramReplacementRanges } from '../../../domain/core/diagrams/diagramSubtreeEdit';
import { revisionScope, reviewRevisionIds, validateRevisionReview, type DiagramRevisionReview } from '../../../domain/core/diagrams/diagramRevisionReview';
import { validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { AgentContext, type AgentContextSnapshot } from '../../../domain/core/agents/agentContext';
import { diagramContextSourceFingerprint, loadDiagramAgentContext, type DiagramAgentContextStore } from '../../../domain/core/diagrams/diagramAgentContext';
import { randomUUID } from 'node:crypto';
import { CanvasHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import type { DiagramGenerator } from '../../../domain/core/diagrams/diagramGeneration';
import type { DiagramRevisionResult, DiagramRevision } from '../../../domain/core/diagrams/diagramRevision';
import type { GridBox } from '../../../domain/core/diagrams/lineGrid';
import type { LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import { editDiagramSchema } from '../../../domain/mapping/agent/diagramEdit';
import type { CreateDiagramInput, DiagramCreation, DiagramEditRun, DiagramRevisionApplication, EditDiagramInput, PromptReference } from '../../../domain/mapping/agent/diagramEdit';
import { defaultTemplateSelection, resolvePromptTemplate, type PromptOperation } from '../../../domain/mapping/agent/promptTemplates';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import { diagramSelectionNodes } from '../../../domain/mapping/workspace/mappingDocument';

export interface DiagramEditCanvasPort {
  snapshot(sessionId: string, revisionIds?: string[]): Promise<LiveDocumentSnapshot>;
  apply(sessionId: string, input: DiagramRevisionApplication): Promise<{ version: number; unresolvedEdgeIds: string[] }>;
  /** Idempotent per requestId. Optional: runtimes without it reject create-diagram. */
  create?(sessionId: string, input: { requestId: string; expectedVersion: number; diagrams: DiagramCreation[] }): Promise<{ version: number }>;
}
interface Run {
  variants?: { variant: DiagramRevisionReview; revision: DiagramRevision }[];
  submission?: GeneratedDiagramEdit;
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
  constructor(private readonly diagrams: DiagramGenerator, private readonly canvas: DiagramEditCanvasPort,
    private readonly diagramContexts?: DiagramAgentContextStore) {}

  start(input: EditDiagramInput | CreateDiagramInput, suppliedContext?: AgentContextSnapshot, operation: PromptOperation = 'edit-diagram', submission?: GeneratedDiagramEdit): DiagramEditRun {
    if (operation === 'edit-diagram' && 'count' in input && input.count !== undefined) throw Error('count applies only to create-diagram');
    if (operation === 'edit-diagram') input = editDiagramSchema.parse(input);
    if (input.agentContext && (input.agentContextId || suppliedContext)) throw Error('Provide only one agent context source');
    if (input.agentContext && !input.llmSessionId) throw Error('Panel context requires llmSessionId');
    const rawContext = input.agentContext ?? suppliedContext;
    const agentContext = rawContext ? AgentContext.fromSnapshot(rawContext).toSnapshot() : undefined;
    if (input.llmSessionId && agentContext && agentContext.source.sourceSessionId !== input.llmSessionId)
      throw Error('AGENT_CONTEXT_SESSION_MISMATCH: context belongs to another panel');
    if (input.agentContextId && !agentContext) throw Error('AGENT_CONTEXT_NOT_FOUND: resolve context before starting the edit');
    if (operation !== 'edit-diagram' && !this.canvas.create) throw Error('Diagram creation UNAVAILABLE in this runtime');
    if (input.variant && operation !== 'edit-diagram') throw Error('Variants require edit-diagram');
    if (input['edit-mode'] !== undefined && operation !== 'edit-diagram') throw Error('edit-mode applies only to edit-diagram');
    if (input['edit-mode'] === 'in-place' && input.variant) throw Error('in-place mode cannot include variant options');
    if (operation !== 'edit-diagram' && (input['replace-mode'] || input.subtree || input.subtrees)) throw Error('Replacement scope applies only to edit-diagram');
    if (submission && (input.variant && input.variant.count !== 1 || 'count' in input && input.count && input.count !== 1)) throw Error('Use one batch operation per submitted diagram or variant');
    if (input.variant?.variantId && input.variant.count !== 1) throw Error('Refine one existing variant at a time');
    if (operation === 'extend-diagram' && (!input.origin || !input.sources?.length)) throw Error('Extend requires a selection and a canvas origin');
    // Fail fast on an unknown template or invalid options instead of after a model call.
    resolvePromptTemplate(input.template ?? defaultTemplateSelection(operation), operation);
    const key = JSON.stringify([input.sessionId, input.requestId]);
    const signature = JSON.stringify({ operation, input, submission, agentContextHash: agentContext?.contentHash });
    const existing = this.requests.get(key);
    if (existing) {
      const run = this.runs.get(existing)!;
      if (run.signature !== signature) throw Error('REQUEST_ID_CONFLICT: edit request differs');
      if (run.state.status === 'awaiting-acknowledgement' && !run.pending) this.launch(run, () => this.install(run));
      return structuredClone(run.state);
    }
    if (this.runs.size >= 500) throw Error('Diagram edit run capacity reached; restart the backend');
    const run: Run = { submission, agentContext, input: structuredClone(input), signature, abort: new AbortController(), state: {
      runId: `diagram-edit-${randomUUID()}`, operation, status: 'generating', nodeId: input.nodeId, baseRevisionId: input.baseRevisionId
    } };
    this.runs.set(run.state.runId, run); this.requests.set(key, run.state.runId);
    this.launch(run, () => this.generate(run));
    return structuredClone(run.state);
  }
  async wait(id: string) { const run = this.runs.get(id); if (!run) throw Error('Diagram edit run not found'); await run.pending; return this.get(id); }
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
    const snapshot = await this.canvas.snapshot(input.sessionId, [...(input.baseRevisionId && input.baseRevisionId !== 'canvas' ? [input.baseRevisionId] : []), ...(input.references ?? []).map(ref => ref.revisionId)]);
    abort.signal.throwIfAborted();
    if (snapshot.version !== input.expectedVersion) throw Error('VERSION_CONFLICT: read the canvas again');
    const box = input.nodeId.startsWith('grid:') && findBox(snapshot.document.scene.root, input.nodeId.slice(5));
    const unanchored = operation === 'create-diagram' && input.nodeId === 'canvas';
    if (!unanchored && (!box || box.kind !== 'diagram')) throw Error('Expected diagram GridBox');
    let base = box && box.kind === 'diagram' ? snapshot.document.scene.contents[box.contentId]
      : createStoredDiagram({ id: `context-${randomUUID()}`, revision: 0, ascii: '[New diagram]' }).diagram;
    if (!unanchored && base.revisionId !== input.baseRevisionId) throw Error('VERSION_CONFLICT: diagram base is no longer current');
    if (!run.submission && !run.agentContext && operation === 'edit-diagram') {
      const bound = snapshot.document.diagramContexts?.[base.diagramId];
      if (bound && bound.sourceFingerprint === diagramContextSourceFingerprint(base))
        run.agentContext = await loadDiagramAgentContext(bound, this.diagramContexts);
    }
    // Import only the exact target/reference revisions, including their logical node identities.
    for (const revision of snapshot.revisions ?? []) importDiagramRevision(revision);
    // Compatibility for in-process adapters that still supply a history record.
    if (!snapshot.revisions && snapshot.history) new CanvasHistory(snapshot.document, snapshot.canvas, snapshot.history, 'current');
    const existing = input.variant?.variantId ? snapshot.document.revisionReviews?.[input.variant.variantId] : undefined;
    if (input.variant?.variantId && !existing) throw Error('Variant not found');
    if (existing) {
      if (existing.diagramId !== base.diagramId) throw Error('Variant belongs to another diagram');
      const retained = await this.canvas.snapshot(input.sessionId, reviewRevisionIds(existing));
      for (const revision of retained.revisions ?? []) importDiagramRevision(revision);
      if (retained.version !== input.expectedVersion) throw Error('VERSION_CONFLICT: canvas changed');
      base = getDiagramRevision(existing.headRevisionId).diagram;
    }
    const template = resolvePromptTemplate(input.template ?? defaultTemplateSelection(operation), operation);
    const references = this.resolveReferences(input.references ?? [], snapshot.history);
    const lines = base.content.ascii.split('\n');
    const editRanges = operation === 'edit-diagram'
      ? existing ? (() => {
        if (input.subtree || input.subtrees) throw Error('Refinement uses the saved variant scope; omit subtree targets');
        if (existing.replacementScope) {
          if (input['replace-mode'] !== existing.replacementScope.mode) throw Error('replace-mode must match the saved variant scope');
          if (existing.replacementScope.ranges.some(range => range.endLine < range.startLine)) throw Error('The saved replacement scope was deleted; select new targets for a new edit');
          return existing.replacementScope.ranges;
        }
        const range = existing.ownerNodeId === 'root' ? undefined : revisionScope(getDiagramRevision(base.revisionId), existing.ownerNodeId);
        if (input['replace-mode'] !== (range ? 'subnode-single' : 'diagram')) throw Error('replace-mode must match the saved variant scope');
        return range ? [range] : [];
      })() : diagramReplacementRanges(base, input['replace-mode']!, input.subtree, input.subtrees)
      : [];
    const editRange = editRanges.length === 1 ? editRanges[0] : undefined;
    if (operation === 'extend-diagram') for (const source of input.sources!) validateConnectionAnchor(snapshot.document.scene, source);
    const request = { operation, sourceMappings: input['source-mappings'] ?? false, editRange, editRanges, instruction: input.prompt, agentContext: run.agentContext, llmSessionId: input.llmSessionId,
      prompt: { markdown: template.markdown, options: template.options, parameters: template.definition.parameters, references },
      context: { diagram: base, selection: { startLine: 1, endLine: lines.length, startColumn: 1,
        endColumn: Math.max(1, ...lines.map(line => line.length)) }, connections: snapshot.document.edges } };
    const options = { signal: abort.signal, onAgentSession: (id: string) => { run.state.agentSessionId = id; },
      onAgentContext: (context: AgentContextSnapshot) => {
        const next = AgentContext.fromSnapshot(context).toSnapshot();
        if (next.source.sourceSessionId !== input.llmSessionId) throw Error('AGENT_CONTEXT_SESSION_MISMATCH');
        run.nextAgentContext = next;
      }, onProgress: (message: string) => { if (run.state.status === 'generating') run.state.message = message; } };
    const produce = (request: Parameters<DiagramGenerator['generate']>[0], options: Parameters<DiagramGenerator['generate']>[1]) =>
      run.submission ? Promise.resolve(submitStoredDiagramEdit(request, run.submission)) : generateDiagram(this.diagrams, request, options);
    if (operation !== 'edit-diagram') {
      run.created = [];
      for (let index = 0; index < (operation === 'extend-diagram' ? 1 : input.count ?? 1); index++) {
        if (input.count && input.count > 1) options.onProgress(`Generating diagram ${index + 1} of ${input.count}…`);
        run.created.push(await produce({ ...request, agentContext: run.nextAgentContext ?? run.agentContext, input: { id: `diagram-${randomUUID()}`, structureKind: base.content.structure.kind,
          source: base.sourceContext.binding, evidence: base.sourceContext.evidence } }, options));
        abort.signal.throwIfAborted();
      }
      await this.place(run);
      return;
    }
    // Keep the existing panel's variant creation/refinement contract supported.
    const variantOptions = input['edit-mode'] === 'variant' ? input.variant ?? { name: 'Alternative', count: 1 } : undefined;
    if (variantOptions) {
      run.variants = [];
      const ownerNodeId = existing?.ownerNodeId ?? (input.subtree ? getDiagramRevision(base.revisionId).nodeRefs[input.subtree.contentNodeId] : 'root');
      if (!ownerNodeId) throw Error('STALE_SUBTREE: select a current subtree');
      for (let index = 0; index < variantOptions.count; index++) {
        options.onProgress(`Generating variant ${index + 1} of ${variantOptions.count}…`);
        const generated = await produce({ ...request,
          instruction: input.prompt + (variantOptions.count > 1 ? `\nProduce alternative ${index + 1} of ${variantOptions.count}; explore a distinct approach.` : ''),
          baseRevisionId: base.revisionId, input: { id: base.id, structureKind: base.content.structure.kind,
            source: base.sourceContext.binding, evidence: base.sourceContext.evidence } }, options);
        abort.signal.throwIfAborted();
        const variant: DiagramRevisionReview = { ...existing, id: existing?.id ?? `variant-${randomUUID()}`,
          name: variantOptions.name + (variantOptions.count > 1 ? ` ${index + 1}` : ''), diagramId: base.diagramId, contentId: base.id,
          ...(input['replace-mode'] === 'multi-contiguous' || input['replace-mode'] === 'multi-disjoint'
            ? { replacementScope: { mode: input['replace-mode'], ranges: generated.replacementRanges! } } : {}),
          ownerNodeId, baseRevisionId: existing?.baseRevisionId ?? base.revisionId, headRevisionId: generated.revision.id,
          revisionIds: [...(existing?.revisionIds ?? []), generated.revision.id], prompt: input.prompt, decisions: {} };
        validateRevisionReview(variant, id => getDiagramRevision(id));
        run.variants.push({ variant, revision: generated.revision });
        run.revision = generated;
      }
      await this.apply(run); return;
    }
    run.revision = await produce({ ...request, baseRevisionId: base.revisionId, input: { id: base.id,
      structureKind: base.content.structure.kind, source: base.sourceContext.binding, evidence: base.sourceContext.evidence } }, options);
    abort.signal.throwIfAborted();
    run.state.generated = { diagramId: run.revision.diagram.diagramId, revisionId: run.revision.revision.id,
      ascii: run.revision.diagram.content.ascii };
    await this.apply(run);
  }
  /** References resolve against the canvas's own revision history first; the service registry covers revisions it issued. */
  private resolveReferences(references: readonly PromptReference[], history?: CanvasHistoryRecord): ResolvedPromptReference[] {
    return references.map((reference, index) => {
      const ref = index + 1;
      let revision: DiagramRevision | undefined = history?.diagramRevisions[reference.revisionId];
      if (!revision) try { revision = getDiagramRevision(reference.revisionId); } catch { /* reported below */ }
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
      expectedVersion: input.expectedVersion, nodeId: input.nodeId, baseRevisionId: input.baseRevisionId, revision,
      ...(run.variants ? { variants: run.variants } : {}) });
    if (run.variants) run.state.variants = run.variants.map(({ variant }) => ({ id: variant.id, name: variant.name, revisionId: variant.headRevisionId }));
    run.state.result = { diagramId: revision.diagramId, previousRevisionId: input.baseRevisionId,
      revisionId: revision.id, documentVersion: result.version, unresolvedEdgeIds: result.unresolvedEdgeIds };
    run.state.agentContext = run.nextAgentContext;
    run.state.status = 'completed'; run.state.message = run.variants
      ? 'Diagram variants saved and workspace persisted' : 'Diagram revision installed and workspace persisted';
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
