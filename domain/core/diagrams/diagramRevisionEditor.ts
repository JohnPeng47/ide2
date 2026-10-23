import { validateDiagramHighlights, rebaseDiagramHighlights, type DiagramHighlight } from './diagramHighlight';
import { validateDiagram, type Diagram, type DiagramInput } from './diagram';
import { constructDiagram } from './internal/constructDiagram';
import { patchDiagramRanges } from './patchDiagram';
import { retainSourceMappings } from './retainSourceMappings';
import { diagramContentNodes } from './diagramContentNodes';
import { activeDiagramJumps, rebaseDiagramJumps, validateDiagramJumps, type DiagramJump } from './diagramJump';

export type ContextId = string;
export type DiagramRevisionId = string;
export interface DiagramRevision {
  readonly id: DiagramRevisionId;
  readonly diagramId: string;
  readonly parentId?: DiagramRevisionId;
  /** Immutable diagram payload. Never returned by resolve(). */
  readonly diagram: Diagram;
  readonly nodeRefs: Readonly<Record<string, string>>;
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
  readonly diagram: Diagram;
  readonly nodeIds: ReadonlyMap<string, string>;
  lineAfter?: (line: number) => number | undefined;
}
export type DiagramEdit =
  | { kind: 'source-mappings'; expectedContentHash: string; mappings: NonNullable<DiagramInput['mappings']>; evidence: NonNullable<DiagramInput['evidence']>; source?: DiagramInput['source'] }
  | { kind: 'patch'; start: number; end: number; patch: string; mappings?: DiagramInput['mappings']; nodeCorrespondence?: Record<string, number> }
  | { kind: 'patches'; retainMappings?: boolean; patches: { start: number; end: number; patch: string[] }[]; mappings?: DiagramInput['mappings']; nodeCorrespondence?: Record<string, number> }
  | { kind: 'replace'; retainMappings?: boolean; input: Omit<DiagramInput, 'id' | 'revision'>; nodeCorrespondence?: Record<string, number> }
  | { kind: 'jumps'; jumps: DiagramJump[] }
  | { kind: 'highlights'; highlights: DiagramHighlight[] };

/** Canonical content ownership; context bindings are supplied by canvas history. */
export interface DiagramRevisionOperations {
  resolve(contextId: ContextId, diagramId: string): DiagramView;
  prepareCreate(input: DiagramInput): PreparedDiagramEdit;
  prepareEdit(contextId: ContextId, diagramId: string, edit: DiagramEdit): PreparedDiagramEdit;
  merge(baseline: Readonly<Record<string, DiagramRevisionId>>, current: Readonly<Record<string, DiagramRevisionId>>,
    proposed: Readonly<Record<string, DiagramRevisionId>>): Record<string, DiagramRevisionId>;
}

export class DiagramRevisionEditor implements DiagramRevisionOperations {
  constructor(private readonly revisions: Record<string, DiagramRevision>,
    private readonly bindings: (contextId: ContextId) => Readonly<Record<string, DiagramRevisionId>>) {}

  private revision(contextId: ContextId, diagramId: string): DiagramRevision {
    const id = this.bindings(contextId)[diagramId], revision = id && this.revisions[id];
    if (!revision || revision.diagram.id !== diagramId) throw new Error(`Unknown diagram: ${diagramId}`);
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
    return { diagram: constructDiagram(input), nodeIds: new Map() };
  }
  prepareEdit(contextId: ContextId, diagramId: string, edit: DiagramEdit): PreparedDiagramEdit {
    const before = this.revision(contextId, diagramId).diagram;
    if (edit.kind === 'source-mappings') {
      if (edit.expectedContentHash !== before.content.asciiSha256) throw new Error('CONTENT_HASH_CONFLICT: read the diagram again');
      const diagram = { ...before, sourceContext: { ...before.sourceContext, mappings: structuredClone(edit.mappings), evidence: structuredClone(edit.evidence),
        ...(edit.source ? { binding: structuredClone(edit.source) } : {}) } };
      validateDiagram(diagram);
      return { diagram, nodeIds: correspondingNodes(before, diagram) };
    }
    if (edit.kind === 'patch' || edit.kind === 'patches') {
      let prepared = patchDiagramRanges(before, edit.kind === 'patch' ? [edit] : edit.patches);
      if (edit.nodeCorrespondence) {
        const nodeIds = this.correspondence(contextId, diagramId, prepared.diagram, prepared.nodeIds, edit.nodeCorrespondence);
        prepared = { ...prepared, nodeIds, diagram: { ...prepared.diagram,
          ...(before.highlights ? { highlights: rebaseDiagramHighlights(before.highlights, nodeIds) } : {}) } };
      }
      if (edit.kind === 'patches' && edit.retainMappings) prepared = { ...prepared, diagram: { ...prepared.diagram, sourceContext: { ...prepared.diagram.sourceContext,
        mappings: retainSourceMappings(before, prepared.diagram, prepared.nodeIds, prepared.lineAfter) } } };
      if (edit.mappings && !(edit.kind === 'patches' && edit.retainMappings)) {
        const sourceContext = constructDiagram({ id: diagramId, revision: prepared.diagram.revision,
          ascii: prepared.diagram.content.ascii, structureKind: prepared.diagram.content.structure.kind,
          source: before.sourceContext.binding, evidence: before.sourceContext.evidence, mappings: edit.mappings }).sourceContext;
        return { ...prepared, diagram: { ...prepared.diagram, sourceContext } };
      }
      return prepared;
    }
    const diagram = edit.kind === 'highlights'
      ? { ...before, highlights: validateDiagramHighlights(edit.highlights) }
      : edit.kind === 'jumps'
      ? { ...structuredClone(before), jumps: validateDiagramJumps(before.content, edit.jumps, false) }
      : constructDiagram({ ...edit.input, id: diagramId, revision: before.revision + 1 });
    const nodeIds = edit.kind === 'replace' ? this.correspondence(contextId, diagramId, diagram, correspondingNodes(before, diagram), edit.nodeCorrespondence) : correspondingNodes(before, diagram);
    let next = edit.kind === 'replace' ? { ...diagram,
      ...(before.jumps ? { jumps: rebaseDiagramJumps(before.content, diagram.content, before.jumps) } : {}),
      ...(before.highlights ? { highlights: rebaseDiagramHighlights(before.highlights, nodeIds) } : {}) } : diagram;
    if (edit.kind === 'replace' && edit.retainMappings) next = { ...next, sourceContext: { ...next.sourceContext, mappings: retainSourceMappings(before, next, nodeIds) } };
    validateDiagram(next);
    return { diagram: next, nodeIds };
  }
  private correspondence(contextId: string, diagramId: string, after: Diagram, inferred: ReadonlyMap<string, string>, claims: Record<string, number> = {}) {
    const base = this.revision(contextId, diagramId), result = new Map(inferred);
    const oldByRef = new Map(Object.entries(base.nodeRefs).map(([node, ref]) => [ref, node]));
    const nodes = diagramContentNodes(after.content);
    for (const [ref, line] of Object.entries(claims)) {
      const old = oldByRef.get(ref), matches = nodes.filter(node => node.line === line);
      if (!old || !Number.isInteger(line) || matches.length !== 1) throw Error('CONTINUITY: claim must identify one old and one output node');
      if (result.has(old) && result.get(old) !== matches[0].id) throw Error('CONTINUITY: claim conflicts with unchanged content');
      result.set(old, matches[0].id);
    }
    if (new Set(result.values()).size !== result.size) throw Error('CONTINUITY: multiple identities claim the same node');
    return result;
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
