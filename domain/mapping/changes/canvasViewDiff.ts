import type { CanvasViewComparison, CanvasViewSnapshot } from '../../core/diagrams/canvasView';
import type { ChangePreviewDocument } from './diagramChangeSession';
import type { MappingCanvasState } from '../workspace/mappingWorkspace';
import { changeDocumentPreview } from './changeDocumentPreview';
import { resolveCanvasPresentation } from '../projections/resolveCanvasPresentation';

function project(snapshot: CanvasViewSnapshot) {
  const { document, identities, unresolved } = resolveCanvasPresentation(snapshot.document, id => snapshot.revisions[id]);
  document.edges = document.edges.filter(edge => !unresolved.has(edge.id + ':source') && !unresolved.has(edge.id + ':target'));
  return { state: { document, canvas: structuredClone(snapshot.view) as MappingCanvasState }, identities };
}

export function canvasViewDiff(comparison: CanvasViewComparison) {
  const before = project(comparison.baseline), after = project(comparison.proposed);
  const correspondence: Record<string, string> = {};
  for (const [contentId, refs] of after.identities) for (const [ref, id] of refs) {
    const old = before.identities.get(contentId)?.get(ref);
    if (old) correspondence[id] = old;
  }
  const doc: ChangePreviewDocument = { id: `view:${comparison.view.id}:${comparison.proposed.checkpointId}`,
    name: comparison.view.name, version: 0, baseline: before.state, proposed: after.state };
  return changeDocumentPreview(doc, correspondence);
}
