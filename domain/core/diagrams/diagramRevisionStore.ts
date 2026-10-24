import { diagramRevisions } from './internal/revisionRegistry';
import { diagramContentNodes } from './diagramContentNodes';
import { createDiagram, reviseDiagram, deriveDiagram, type DiagramRevision, type DiagramRevisionResult, type DiagramRevisionSummary } from './diagramRevision';
import { submitDiagramEdit } from './submitDiagramEdit';
import type { DiagramInput } from './diagram';
import type { DiagramEdit } from './diagramRevisionEditor';
import type { DiagramGenerationRequest } from './diagramGeneration';
import type { GeneratedDiagramEdit } from './generatedDiagramEdit';

/** Runtime storage API. Durable adapters flush retained revisions before publishing bindings. */
export function getDiagramRevision(id: string): DiagramRevision { return diagramRevisions.get(id); }
export function listDiagramRevisions(diagramId: string): readonly DiagramRevisionSummary[] {
  return Object.freeze(diagramRevisions.list(diagramId).map(({ id, diagramId, parentId }) => Object.freeze({ id, diagramId, parentId })));
}
export function importDiagramRevision(revision: DiagramRevision): void {
  const refs = diagramContentNodes(revision.diagram.content).map(node => revision.nodeRefs?.[node.id]);
  if (refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length) throw Error('Invalid logical node identities');
  diagramRevisions.register(revision);
}
export function retainDiagramRevision(result: DiagramRevisionResult): DiagramRevisionResult {
  importDiagramRevision(result.revision);
  const revision = getDiagramRevision(result.revision.id);
  return { ...result, diagram: revision.diagram, revision };
}
// Convenience commands for existing synchronous callers; the domain operations above work without this store.
export function createStoredDiagram(input: DiagramInput) { return retainDiagramRevision(createDiagram(input)); }
export function reviseStoredDiagram(baseId: string, edit: DiagramEdit) { return retainDiagramRevision(reviseDiagram(getDiagramRevision(baseId), edit)); }
export function deriveStoredDiagram(baseId: string, input: Omit<DiagramInput, 'id' | 'revision'>, refs: Record<string, number>, sources: readonly string[]) {
  return retainDiagramRevision(deriveDiagram(getDiagramRevision(baseId), input, refs, sources.map(getDiagramRevision)));
}
export function submitStoredDiagramEdit(request: DiagramGenerationRequest, candidate: GeneratedDiagramEdit, correspondence?: Record<string, number>) {
  return retainDiagramRevision(submitDiagramEdit(request, candidate, request.baseRevisionId ? getDiagramRevision(request.baseRevisionId) : undefined, correspondence));
}
