import { createDiagram, validateDiagram, type Diagram, type DiagramInput } from './diagram';
import { patchDiagram } from './patchDiagram';
import { diagramContentNodes } from './diagramContentNodes';
import { activeDiagramJumps, validateDiagramJumps, type DiagramJump } from './diagramJump';

export type ContextId = string;
export type DiagramRevisionId = string;
export interface DiagramRevision {
  id: DiagramRevisionId;
  diagramId: string;
  parentId?: DiagramRevisionId;
  /** Storage/legacy transport payload. Never returned by resolve(). */
  diagram: Diagram;
  nodeRefs: Record<string, string>;
}
export interface DiagramView {
  id: string;
  ascii: string;
  asciiSha256: string;
  structureKind: 'diagram' | 'tree';
  nodes: ReturnType<typeof diagramContentNodes>;
  sourceContext: Diagram['sourceContext'];
  jumps: { id: string; source: Omit<DiagramJump['source'], 'revisionId' | 'contentHash'>; target: DiagramJump['target'] }[];
}
export interface PreparedDiagramEdit {
  diagram: Diagram;
  nodeIds: ReadonlyMap<string, string>;
  lineAfter?: (line: number) => number | undefined;
}
export type DiagramEdit =
  | { kind: 'patch'; start: number; end: number; patch: string; mappings?: DiagramInput['mappings'] }
  | { kind: 'replace'; input: Omit<DiagramInput, 'id' | 'revision'> }
  | { kind: 'jumps'; jumps: DiagramJump[] };

/** Canonical content ownership; context bindings are supplied by canvas history. */
export interface DiagramService {
  resolve(contextId: ContextId, diagramId: string): DiagramView;
  prepareCreate(input: DiagramInput): PreparedDiagramEdit;
  prepareEdit(contextId: ContextId, diagramId: string, edit: DiagramEdit): PreparedDiagramEdit;
  merge(baseline: Readonly<Record<string, DiagramRevisionId>>, current: Readonly<Record<string, DiagramRevisionId>>,
    proposed: Readonly<Record<string, DiagramRevisionId>>): Record<string, DiagramRevisionId>;
}

export class RevisionedDiagramService implements DiagramService {
  constructor(private readonly revisions: Record<string, DiagramRevision>,
    private readonly bindings: (contextId: ContextId) => Readonly<Record<string, DiagramRevisionId>>) {}

  private revision(contextId: ContextId, diagramId: string): DiagramRevision {
    const id = this.bindings(contextId)[diagramId], revision = id && this.revisions[id];
    if (!revision || revision.diagramId !== diagramId) throw new Error(`Unknown diagram: ${diagramId}`);
    return revision;
  }
  resolve(contextId: ContextId, diagramId: string): DiagramView {
    const { diagram, nodeRefs } = this.revision(contextId, diagramId);
    const nodes = diagramContentNodes(diagram.content).map(node => ({ ...node, id: nodeRefs[node.id],
      parentId: node.parentId ? nodeRefs[node.parentId] : undefined, childIds: node.childIds.map(id => nodeRefs[id]) }));
    return structuredClone({ id: diagramId, ascii: diagram.content.ascii, asciiSha256: diagram.content.asciiSha256,
      structureKind: diagram.content.structure.kind, nodes, sourceContext: diagram.sourceContext,
      jumps: activeDiagramJumps(diagram.content, diagram.jumps).map(jump => {
        const { revisionId: _, contentHash: __, ...source } = jump.source;
        return { id: jump.id, source: { ...source, contentNodeId: source.contentNodeId ? nodeRefs[source.contentNodeId] : undefined }, target: jump.target };
      }) });
  }
  prepareCreate(input: DiagramInput): PreparedDiagramEdit {
    return { diagram: createDiagram(input), nodeIds: new Map() };
  }
  prepareEdit(contextId: ContextId, diagramId: string, edit: DiagramEdit): PreparedDiagramEdit {
    const before = this.revision(contextId, diagramId).diagram;
    if (edit.kind === 'patch') {
      const prepared = patchDiagram(before, edit.start, edit.end, edit.patch);
      if (edit.mappings) {
        const sourceContext = createDiagram({ id: diagramId, revision: prepared.diagram.revision,
          ascii: prepared.diagram.content.ascii, structureKind: prepared.diagram.content.structure.kind,
          source: before.sourceContext.binding, evidence: before.sourceContext.evidence, mappings: edit.mappings }).sourceContext;
        prepared.diagram = { ...prepared.diagram, sourceContext };
      }
      return prepared;
    }
    const diagram = edit.kind === 'jumps'
      ? { ...structuredClone(before), jumps: validateDiagramJumps(before.content, edit.jumps, false) }
      : createDiagram({ ...edit.input, id: diagramId, revision: before.revision + 1 });
    validateDiagram(diagram);
    return { diagram, nodeIds: correspondingNodes(before, diagram) };
  }
  /** Deliberately conservative until three-way merge is implemented. */
  merge(baseline: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>, proposed: Readonly<Record<string, string>>) {
    for (const id of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
      if (baseline[id] !== current[id]) throw new Error(`MERGE_REQUIRED: diagram ${id} advanced; automatic merge is not implemented`);
    }
    return { ...proposed };
  }
}

/** Exact identity only. Heuristic preview matches must never establish anchors. */
export function correspondingNodes(before: Diagram, after: Diagram): Map<string, string> {
  const result = new Map<string, string>();
  if (before.content.ascii !== after.content.ascii || before.content.structure.kind !== after.content.structure.kind) return result;
  const next = diagramContentNodes(after.content);
  for (const node of diagramContentNodes(before.content)) {
    const matches = next.filter(n => n.line === node.line && n.startColumn === node.startColumn && n.endColumn === node.endColumn && n.label === node.label);
    if (matches.length === 1) result.set(node.id, matches[0].id);
  }
  return result;
}
