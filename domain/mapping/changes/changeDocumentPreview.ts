import type { GridBox } from '../../core/diagrams/lineGrid';
import type { ChangePreviewDocument } from './diagramChangeSession';
import { diffChangeDocument } from './changeDocumentDiff';

const diagramBoxes = (root: GridBox, origin = { column: 0, row: 0 }): Extract<GridBox, { kind: 'diagram' }>[] => {
  const position = { column: origin.column + root.position.column, row: origin.row + root.position.row };
  return root.kind === 'diagram' ? [{ ...root, position }] : root.children.flatMap(child => diagramBoxes(child, position));
};

/** Retain deleted diagrams as preview-only ghost boxes. Never mutate stored evidence. */
export function changeDocumentPreview(source: ChangePreviewDocument, correspondence: Readonly<Record<string, string>> = {}) {
  const doc = structuredClone(source);
  const diff = diffChangeDocument(doc, correspondence);
  const beforeBoxes = doc.baseline ? diagramBoxes(doc.baseline.document.scene.root) : [], afterBoxes = diagramBoxes(doc.proposed.document.scene.root);
  const beforeIds = new Set(beforeBoxes.map(box => `grid:${box.id}`)), afterIds = new Set(afterBoxes.map(box => `grid:${box.id}`));
  const removedDiagramIds = new Set([...beforeIds].filter(id => !afterIds.has(id)));
  const modifiedDiagramIds = new Set([...afterIds].filter(id => beforeIds.has(id)));
  // Retain deleted diagrams as ghost boxes in the preview, without restoring them to the canvas.
  const ghosts = beforeBoxes.filter(box => removedDiagramIds.has(`grid:${box.id}`)).map(box => {
    const contentId = `removed:${box.id}:${box.contentId}`;
    const diagram = doc.baseline!.document.scene.contents[box.contentId];
    doc.proposed.document.scene.contents = { ...doc.proposed.document.scene.contents, [contentId]: { ...diagram, id: contentId } };
    doc.proposed.document.diagramPresentations = { ...doc.proposed.document.diagramPresentations, [contentId]: doc.baseline!.document.diagramPresentations?.[box.contentId] ?? { highlights: diagram.highlights } };
    return { ...box, contentId, collapsedContentId: undefined, collapsed: false };
  });
  if (ghosts.length) {
    const root = doc.proposed.document.scene.root;
    doc.proposed.document.scene.root = { id: `preview-root:${doc.id}`, kind: 'container', position: { column: 0, row: 0 },
      collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [root, ...ghosts] };
  }
  return { doc, diff, modifiedDiagramIds, removedDiagramIds };
}
