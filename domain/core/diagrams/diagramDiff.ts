import type { DiagramRevision } from './diagramRevision';
import { diffDiagramContent } from './diagramContentDiff';

/** Domain comparison; shared by every presentation surface. */
export function compareDiagramRevisions(before: DiagramRevision | undefined, after: DiagramRevision | undefined) {
  if (before && after && before.diagramId !== after.diagramId) throw Error('Cannot compare revisions of different diagrams');
  const oldIds = new Map(Object.entries(before?.nodeRefs ?? {}).map(([id, ref]) => [ref, id]));
  const correspondence = Object.fromEntries(Object.entries(after?.nodeRefs ?? {}).flatMap(([id, ref]) => {
    const old = oldIds.get(ref); return old ? [[id, old]] : [];
  }));
  return diffDiagramContent(before?.diagram.content, after?.diagram.content, {}, correspondence);
}
