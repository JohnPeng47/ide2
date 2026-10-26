import type { CanvasViewComparison } from '../diagrams/canvasView';
import type { ResolvedCanvasDocument } from '../diagrams/canvasHistory';
import type { GridBox } from '../diagrams/lineGrid';
import { emptyDiagramAlternatives, type DiagramAlternative } from './diagramAlternative';
import { sha256 } from '../sha256';

const diagrams = (box: GridBox): Extract<GridBox, { kind: 'diagram' }>[] =>
  box.kind === 'diagram' ? [box] : box.children.flatMap(diagrams);

/** Pin the recorded comparison, including unchanged diagrams, without issuing content revisions. */
export function canvasViewAlternatives(comparison: CanvasViewComparison): DiagramAlternative[] {
  const before = new Map(diagrams(comparison.baseline.document.scene.root).map(box => [box.id, box]));
  return diagrams(comparison.proposed.document.scene.root).flatMap(box => {
    const previous = before.get(box.id);
    if (!previous) return []; // An added placement has no whole-Diagram comparison pair.
    const base = comparison.baseline.document.scene.contents[previous.contentId];
    const source = comparison.proposed.document.scene.contents[box.contentId];
    if (base.diagramId !== source.diagramId) return [];
    return [{ id: `alternative-${sha256(JSON.stringify([comparison.view.id, box.id, 'diff'])).slice(0, 32)}`,
      name: `Diff: ${comparison.view.name}`.slice(0, 120), display: 'diff' as const,
      diagramId: source.diagramId, presentationId: `grid:${box.id}`,
      parts: [{ target: { kind: 'diagram' as const }, source: { revisionId: source.revisionId, scope: { kind: 'diagram' as const } }, baseRevisionId: base.revisionId }] }];
  });
}

export function withCanvasViewAlternatives(document: ResolvedCanvasDocument, items: DiagramAlternative[]): ResolvedCanvasDocument {
  const alternatives = structuredClone(document.alternatives ?? emptyDiagramAlternatives());
  const placements = new Map(diagrams(document.scene.root).map(box => [`grid:${box.id}`, box]));
  for (const item of items) {
    const box = placements.get(item.presentationId);
    if (box && document.scene.contents[box.contentId].diagramId === item.diagramId)
      alternatives.items[item.id] = structuredClone(item);
  }
  return { ...document, alternatives };
}
