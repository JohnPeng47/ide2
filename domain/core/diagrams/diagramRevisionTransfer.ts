import { validateDiagram } from './diagram';
import { diagramContentNodes } from './diagramContentNodes';
import { correspondingNodes, type DiagramRevision } from './diagramRevisionEditor';
import { diagramRevisions } from './internal/revisionRegistry';

/** Internal transport boundary for a service-issued child revision, not a content-edit API. */
export function receiveDiagramRevision(baseRevisionId: string, revision: DiagramRevision) {
  const base = diagramRevisions.get(baseRevisionId);
  validateDiagram(revision.diagram);
  if (revision.id === base.id || revision.id !== revision.diagram.revisionId || revision.parentId !== base.id
    || revision.diagramId !== base.diagramId || revision.diagram.diagramId !== base.diagramId
    || revision.diagram.id !== base.diagram.id || revision.diagram.revision !== base.diagram.revision + 1)
    throw Error('Invalid generated diagram revision ancestry');
  const nodes = diagramContentNodes(revision.diagram.content);
  const refs = nodes.map(node => revision.nodeRefs?.[node.id]);
  if (!revision.nodeRefs || Object.keys(revision.nodeRefs).length !== nodes.length
    || refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length)
    throw Error('Invalid generated logical node identities');
  for (const [old, next] of correspondingNodes(base.diagram, revision.diagram)) if (base.nodeRefs[old] !== revision.nodeRefs[next])
    throw Error('Generated revision changed an unchanged logical node identity');
  // Subtree patches retain logical identities even when lines shift. Recover the
  // correspondence from the issued revision instead of comparing whole ASCII.
  const nextByRef = new Map(Object.entries(revision.nodeRefs).map(([node, ref]) => [ref, node]));
  const nodeIds = new Map<string, string>();
  for (const [old, ref] of Object.entries(base.nodeRefs)) {
    const next = nextByRef.get(ref);
    if (next) nodeIds.set(old, next);
  }
  return { diagram: diagramRevisions.register(revision).diagram, nodeIds };
}
