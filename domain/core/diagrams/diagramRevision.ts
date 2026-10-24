import { deepFreeze } from '../immutability';
import { validateDiagram, type DiagramInput } from './diagram';
import { DiagramRevisionEditor, type DiagramRevision, type DiagramEdit, type PreparedDiagramEdit } from './diagramRevisionEditor';
import { diagramContentNodes } from './diagramContentNodes';
import type { SubtreeRange } from './diagramSubtreeEdit';
export type { DiagramRevision, DiagramEdit, DiagramRevisionId } from './diagramRevisionEditor';
export interface DiagramRevisionResult extends PreparedDiagramEdit { readonly revision: DiagramRevision; replacementRanges?: SubtreeRange[] }
export type DiagramRevisionSummary = Readonly<Pick<DiagramRevision, 'id' | 'diagramId' | 'parentId'>>;

// Domain operations return immutable revisions. Persistence/publication is explicit.
export function createDiagram(input: DiagramInput): DiagramRevisionResult {
  const prepared = new DiagramRevisionEditor({}, () => ({})).prepareCreate(input);
  return issueDiagramRevision(prepared);
}
export function reviseDiagram(base: DiagramRevision, edit: DiagramEdit): DiagramRevisionResult {
  const prepared = new DiagramRevisionEditor({ [base.id]: base }, () => ({ [base.diagram.id]: base.id }))
    .prepareEdit('edit', base.diagram.id, edit);
  if (prepared.diagram === base.diagram) return { ...prepared, revision: base };
  return issueDiagramRevision({ ...prepared, diagram: { ...prepared.diagram, diagramId: base.diagramId, revisionId: `diagram-revision-${crypto.randomUUID()}` } }, base);
}
export function deriveDiagram(base: DiagramRevision, input: Omit<DiagramInput, 'id' | 'revision'>, refs: Record<string, number>, sources: readonly DiagramRevision[]) {
  const allowed = new Set<string>();
  for (const source of sources) {
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
  return issueDiagramRevision({ ...prepared, diagram: { ...prepared.diagram, diagramId: base.diagramId, revisionId: `diagram-revision-${crypto.randomUUID()}` } }, base, identities);
}
function issueDiagramRevision(prepared: PreparedDiagramEdit, base?: DiagramRevision, identities = new Map<string, string>()): DiagramRevisionResult {
  const reverse = new Map([...prepared.nodeIds].map(([old, next]) => [next, old]));
  const record = deepFreeze({ id: prepared.diagram.revisionId, diagramId: prepared.diagram.diagramId,
    ...(base ? { parentId: base.id } : {}), diagram: prepared.diagram,
    nodeRefs: Object.fromEntries(diagramContentNodes(prepared.diagram.content).map(node => {
      const old = reverse.get(node.id);
      return [node.id, identities.get(node.id) || old && base?.nodeRefs[old] || `node-${crypto.randomUUID()}`];
    })) });
  validateDiagram(record.diagram);
  return { ...prepared, diagram: record.diagram, revision: record };
}
