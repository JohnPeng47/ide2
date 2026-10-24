import type { DiagramContent } from '../../core/diagrams/diagramContent';
import type { ChangeDocumentState, ChangePreviewDocument, ChangeSessionDocument } from './diagramChangeSession';
import { diffDiagramContent } from '../../core/diagrams/diagramContentDiff';

/** All displayed diagrams, including those currently hidden by group folds. */
export function diffChangeDocument(doc: ChangePreviewDocument | ChangeSessionDocument, correspondence: Readonly<Record<string, string>> = {}) {
  const contents = (state: ChangeDocumentState | null) => {
    const result = new Map<string, DiagramContent>();
    const visit = (box: NonNullable<typeof state>['document']['scene']['root']) => {
      if (box.kind === 'diagram') result.set(`grid:${box.id}`, state!.document.scene.contents[box.contentId].content);
      else box.children.forEach(visit);
    };
    if (state) visit(state.document.scene.root);
    return result;
  };
  const before = contents(doc.baseline), after = contents(doc.proposed);
  const diagrams = new Map([...new Set([...before.keys(), ...after.keys()])].map(id =>
    [id, diffDiagramContent(before.get(id), after.get(id), doc.proposed.nodeOrigins, correspondence)]));
  const counts = { added: 0, removed: 0, modified: 0, moved: 0 };
  for (const diff of diagrams.values()) for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] += diff.counts[key];
  return { diagrams, counts };
}
