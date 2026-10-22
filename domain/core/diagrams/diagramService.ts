import { subtreeReplacement, type SubtreeRange } from './diagramSubtreeEdit';
import type { AgentContextSnapshot } from '../agents/agentContext';
import type { Diagram, DiagramInput } from './diagram';
import { DiagramRevisionEditor, type DiagramEdit, type DiagramRevision, type PreparedDiagramEdit } from './diagramRevisionEditor';
import { diagramContentNodes } from './diagramContentNodes';
import { diagramRevisions } from './internal/revisionRegistry';
import { stripNodeContinuity } from './diagramNodeContinuity';

export type { DiagramEdit, DiagramRevision, DiagramRevisionId } from './diagramRevisionEditor';
export interface DiagramRevisionResult extends PreparedDiagramEdit { readonly revision: DiagramRevision }
export type DiagramRevisionSummary = Readonly<Pick<DiagramRevision, 'id' | 'diagramId' | 'parentId'>>;
/** The parts of a template parameter that rendering needs. */
export type GenerationPromptParameter =
  | { kind: 'enum'; key: string; options: readonly { value: string; guidance: string }[] }
  | { kind: 'number'; key: string };
export interface DiagramGenerationRequest {
  /** Authoritative parsed-node -> logical-node identities, supplied by DiagramService. */
  nodeRefs?: Readonly<Record<string, string>>;
  agentContext?: AgentContextSnapshot;
  llmSessionId?: string;
  input: Omit<DiagramInput, 'revision' | 'ascii'>;
  instruction: string;
  /** Structured prompt: a validated template with options plus resolved, revision-pinned references. */
  prompt?: {
    markdown: string;
    options: Readonly<Record<string, string | number>>;
    parameters: readonly GenerationPromptParameter[];
    references: readonly unknown[];
  };
  baseRevisionId?: string;
  editRange?: SubtreeRange;
  context?: {
    diagram: Diagram;
    connections?: readonly import('./diagramConnection').DiagramConnection[];
    selection: { startLine: number; endLine: number; startColumn: number; endColumn: number };
    projectId?: string; representationId?: string; baseRevisionId?: string;
  };
}
export interface GenerationOptions {
  signal?: AbortSignal; onProgress?: (message: string) => void;
  onAgentSession?: (sessionId: string) => void;
  onAgentContext?: (context: AgentContextSnapshot) => void;
}
export interface DiagramGenerator {
  generate(request: DiagramGenerationRequest, options: GenerationOptions): Promise<Omit<DiagramInput, 'id' | 'revision'> & { nodeCorrespondence?: Record<string, number> }>;
}

/** Sole content writer. Local revisions are synchronous; durable adapters flush issued records before publishing canvases. */
export interface DiagramService {
  create(input: DiagramInput): DiagramRevisionResult;
  /** Hydrate a validated standalone revision before editing after a restart/worker read. */
  importRevision(revision: DiagramRevision): void;
  getRevision(revisionId: string): DiagramRevision;
  listRevisions(diagramId: string): readonly DiagramRevisionSummary[];
  revise(baseRevisionId: string, edit: DiagramEdit): DiagramRevisionResult;
  /** Compose a reviewed revision using identities proven by retained source revisions. */
  derive(baseRevisionId: string, input: Omit<DiagramInput, 'id' | 'revision'>, refs: Record<string, number>, sources: readonly string[]): DiagramRevisionResult;
  generate(request: DiagramGenerationRequest, options?: GenerationOptions): Promise<DiagramRevisionResult>;
}

export class RevisionedDiagramService implements DiagramService {
  constructor(private readonly generator?: DiagramGenerator) {}
  importRevision(revision: DiagramRevision): void {
    const nodes = diagramContentNodes(revision.diagram.content);
    const refs = nodes.map(node => revision.nodeRefs?.[node.id]);
    if (refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length) throw Error('Invalid logical node identities');
    diagramRevisions.register(revision);
  }
  create(input: DiagramInput): DiagramRevisionResult {
    const prepared = new DiagramRevisionEditor({}, () => ({})).prepareCreate(input);
    return this.issue(prepared);
  }
  getRevision(revisionId: string) { return diagramRevisions.get(revisionId); }
  listRevisions(diagramId: string): readonly DiagramRevisionSummary[] {
    return Object.freeze(diagramRevisions.list(diagramId).map(({id, diagramId, parentId}) => Object.freeze({id, diagramId, parentId})));
  }
  revise(baseRevisionId: string, edit: DiagramEdit): DiagramRevisionResult {
    const base = this.getRevision(baseRevisionId);
    const prepared = new DiagramRevisionEditor({ [base.id]: base }, () => ({ [base.diagram.id]: base.id }))
      .prepareEdit('edit', base.diagram.id, edit);
    if (prepared.diagram === base.diagram) return { ...prepared, revision: base };
    return this.issue({ ...prepared, diagram: { ...prepared.diagram, diagramId: base.diagramId, revisionId: `diagram-revision-${crypto.randomUUID()}` } }, base);
  }
  derive(baseRevisionId: string, input: Omit<DiagramInput, 'id' | 'revision'>, refs: Record<string, number>, sources: readonly string[]) {
    const base = this.getRevision(baseRevisionId), allowed = new Set<string>();
    for (const id of sources) {
      const source = this.getRevision(id);
      if (source.diagramId !== base.diagramId) throw Error('Identity source belongs to another diagram');
      Object.values(source.nodeRefs).forEach(ref => allowed.add(ref));
    }
    const editor = new DiagramRevisionEditor({ [base.id]: base }, () => ({ [base.diagram.id]: base.id }));
    const prepared = editor.prepareEdit('derive', base.diagram.id, { kind: 'replace', input,
      nodeCorrespondence: Object.fromEntries(Object.entries(refs).filter(([ref]) => Object.values(base.nodeRefs).includes(ref))) });
    const nodes = diagramContentNodes(prepared.diagram.content), identities = new Map<string, string>();
    for (const [ref, line] of Object.entries(refs)) {
      const matching = nodes.filter(node => node.line === line);
      if (!allowed.has(ref) || matching.length !== 1 || identities.has(matching[0].id)) throw Error('Invalid derived node identity');
      identities.set(matching[0].id, ref);
    }
    return this.issue({ ...prepared, diagram: { ...prepared.diagram, diagramId: base.diagramId, revisionId: `diagram-revision-${crypto.randomUUID()}` } }, base, identities);
  }
  private issue(prepared: PreparedDiagramEdit, base?: DiagramRevision, identities = new Map<string, string>()): DiagramRevisionResult {
    const reverse = new Map([...prepared.nodeIds].map(([old, next]) => [next, old]));
    const record = diagramRevisions.register({ id: prepared.diagram.revisionId, diagramId: prepared.diagram.diagramId,
      ...(base ? { parentId: base.id } : {}), diagram: prepared.diagram,
      nodeRefs: Object.fromEntries(diagramContentNodes(prepared.diagram.content).map(node => {
        const old = reverse.get(node.id);
        return [node.id, identities.get(node.id) || old && base?.nodeRefs[old] || `node-${crypto.randomUUID()}`];
      })) });
    return { ...prepared, diagram: record.diagram, revision: record };
  }
  async generate(request: DiagramGenerationRequest, options: GenerationOptions = {}) {
    if (!this.generator) throw Error('Diagram generation is unavailable in this runtime');
    options.signal?.throwIfAborted();
    if (request.baseRevisionId && this.getRevision(request.baseRevisionId).diagram.id !== request.input.id)
      throw Error('Generation base belongs to another diagram');
    const raw = await this.generator.generate(structuredClone({ ...request,
      nodeRefs: request.baseRevisionId ? this.getRevision(request.baseRevisionId).nodeRefs : {} }), options);
    const stripped = stripNodeContinuity(raw.ascii, request.baseRevisionId ? this.getRevision(request.baseRevisionId).nodeRefs : {});
    const generated = { ...raw, ascii: stripped.ascii, nodeCorrespondence: { ...raw.nodeCorrespondence, ...stripped.nodeCorrespondence } };
    options.signal?.throwIfAborted();
    if (request.baseRevisionId && request.editRange) {
      const base = this.getRevision(request.baseRevisionId).diagram;
      const patch = subtreeReplacement(base, generated.ascii, request.editRange);
      // patchDiagram rebases untouched mappings and logical identities. Only accept generated mappings inside the replacement.
      const inserted = patch ? patch.split('\n').length : 0;
      const delta = inserted - (request.editRange.endLine - request.editRange.startLine + 1);
      const retained = base.sourceContext.mappings.filter(m => m.line < request.editRange!.startLine || m.line > request.editRange!.endLine)
        .map(m => ({ ...m, line: m.line > request.editRange!.endLine ? m.line + delta : m.line }));
      const retainedIds = new Set(retained.map(m => m.id));
      const mappings = [...retained, ...(generated.mappings ?? []).filter(m => m.line >= request.editRange!.startLine
        && m.line < request.editRange!.startLine + inserted && !retainedIds.has(m.id))];
      return this.revise(request.baseRevisionId, { kind: 'patch', start: request.editRange.startLine, end: request.editRange.endLine, patch, mappings, nodeCorrespondence: generated.nodeCorrespondence });
    }
    return request.baseRevisionId
      ? this.revise(request.baseRevisionId, { kind: 'replace', input: generated, nodeCorrespondence: generated.nodeCorrespondence })
      : this.create({ ...request.input, ...generated, id: request.input.id, revision: 0 });
  }
}
