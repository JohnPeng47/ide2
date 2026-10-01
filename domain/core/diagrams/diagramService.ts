import type { Diagram, DiagramInput } from './diagram';
import { DiagramRevisionEditor, type DiagramEdit, type DiagramRevision, type PreparedDiagramEdit } from './diagramRevisionEditor';
import { diagramContentNodes } from './diagramContentNodes';
import { diagramRevisions } from './internal/revisionRegistry';

export type { DiagramEdit, DiagramRevision, DiagramRevisionId } from './diagramRevisionEditor';
export interface DiagramRevisionResult extends PreparedDiagramEdit { readonly revision: DiagramRevision }
export type DiagramRevisionSummary = Readonly<Pick<DiagramRevision, 'id' | 'diagramId' | 'parentId'>>;
export interface DiagramGenerationRequest {
  input: Omit<DiagramInput, 'revision' | 'ascii'>;
  instruction: string;
  baseRevisionId?: string;
  context?: {
    diagram: Diagram;
    connections?: readonly import('./diagramConnection').DiagramConnection[];
    selection: { startLine: number; endLine: number; startColumn: number; endColumn: number };
    projectId?: string; representationId?: string; baseRevisionId?: string;
  };
}
export interface GenerationOptions { signal?: AbortSignal; onProgress?: (message: string) => void }
export interface DiagramGenerator {
  generate(request: DiagramGenerationRequest, options: GenerationOptions): Promise<Omit<DiagramInput, 'id' | 'revision'>>;
}

/** Sole content writer. Local revisions are synchronous; durable adapters flush issued records before publishing canvases. */
export interface DiagramService {
  create(input: DiagramInput): DiagramRevisionResult;
  getRevision(revisionId: string): DiagramRevision;
  listRevisions(diagramId: string): readonly DiagramRevisionSummary[];
  revise(baseRevisionId: string, edit: DiagramEdit): DiagramRevisionResult;
  generate(request: DiagramGenerationRequest, options?: GenerationOptions): Promise<DiagramRevisionResult>;
}

export class RevisionedDiagramService implements DiagramService {
  constructor(private readonly generator?: DiagramGenerator) {}
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
  private issue(prepared: PreparedDiagramEdit, base?: DiagramRevision): DiagramRevisionResult {
    const reverse = new Map([...prepared.nodeIds].map(([old, next]) => [next, old]));
    const record = diagramRevisions.register({ id: prepared.diagram.revisionId, diagramId: prepared.diagram.diagramId,
      ...(base ? { parentId: base.id } : {}), diagram: prepared.diagram,
      nodeRefs: Object.fromEntries(diagramContentNodes(prepared.diagram.content).map(node => {
        const old = reverse.get(node.id);
        return [node.id, old && base?.nodeRefs[old] || `node-${crypto.randomUUID()}`];
      })) });
    return { ...prepared, diagram: record.diagram, revision: record };
  }
  async generate(request: DiagramGenerationRequest, options: GenerationOptions = {}) {
    if (!this.generator) throw Error('Diagram generation is unavailable in this runtime');
    options.signal?.throwIfAborted();
    if (request.baseRevisionId && this.getRevision(request.baseRevisionId).diagram.id !== request.input.id)
      throw Error('Generation base belongs to another diagram');
    const generated = await this.generator.generate(structuredClone(request), options);
    options.signal?.throwIfAborted();
    return request.baseRevisionId
      ? this.revise(request.baseRevisionId, { kind: 'replace', input: generated })
      : this.create({ ...request.input, ...generated, id: request.input.id, revision: 0 });
  }
}
