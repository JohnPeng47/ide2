import { alternativeSelections, emptyDiagramAlternatives } from '../../core/presentation/diagramAlternative';
import { presentationHighlights } from '../../core/presentation/diagramPresentation';
import { rebaseDiagramHighlights, type DiagramHighlight } from '../../core/diagrams/diagramHighlight';
import type { CanvasViewComparison, CanvasViewSnapshot } from '../../core/diagrams/canvasView';
import { buildDiagramContent } from '../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { resolveRevisionLines } from '../../core/diagrams/diagramRevisionSelection';
import type { DiagramAnchor } from '../../core/diagrams/diagramConnection';
import type { GridBox } from '../../core/diagrams/lineGrid';
import type { ChangeDocumentState, ChangePreviewDocument } from './diagramChangeSession';
import type { MappingCanvasState } from '../workspace/mappingWorkspace';
import { diffChangeDocument } from './changeDocumentDiff';

const diagramBoxes = (root: GridBox, origin = { column: 0, row: 0 }): Extract<GridBox, { kind: 'diagram' }>[] => {
  const position = { column: origin.column + root.position.column, row: origin.row + root.position.row };
  return root.kind === 'diagram' ? [{ ...root, position }] : root.children.flatMap(child => diagramBoxes(child, position));
};

/** Rendering projection only: never issues revisions or changes the stored selection. */
function project(snapshot: CanvasViewSnapshot) {
  const document = structuredClone(snapshot.document);
  const identities = new Map<string, Map<string, string>>();
  const replacements = new Map<string, string>();
  const placements = diagramBoxes(document.scene.root);
  const rename = new Map<string, string>();
  for (const box of placements) {
    const originalContentId = box.contentId;
    const contentId = placements.filter(other => other.contentId === originalContentId).length > 1 ? `placement:${box.id}:${originalContentId}` : originalContentId;
    const diagram = { ...snapshot.document.scene.contents[originalContentId], id: contentId };
    rename.set(box.id, contentId);
    document.scene.contents = { ...document.scene.contents, [contentId]: diagram };
    if (document.diagramPresentations?.[originalContentId]) document.diagramPresentations[contentId] = document.diagramPresentations[originalContentId];
    const choices = alternativeSelections(document, `grid:${box.id}`, originalContentId, snapshot.revisions[diagram.revisionId]);
    const revision = snapshot.revisions[diagram.revisionId];
    const hasSelection = Object.values(choices.revisionSelections ?? {}).some(selection => selection.contentId === originalContentId);
    let refs: Record<string, string> = { ...revision.nodeRefs };
    if (hasSelection) {
      const rows = resolveRevisionLines(revision, choices, id => snapshot.revisions[id]);
      const ascii = rows.map(row => row.revision.diagram.content.ascii.split('\n')[row.sourceLine - 1]).join('\n');
      const structure = rows[0]?.revision.diagram.content.structure ?? diagram.content.structure;
      const content = buildDiagramContent(ascii, diagram.content.revisionId, structure.kind,
        structure.kind === 'tree' ? structure.parserVersion : undefined);
      refs = {};
      const remap = new Map<string, string>();
      for (const node of diagramContentNodes(content)) {
        const row = rows[node.line - 1];
        const source = diagramContentNodes(row.revision.diagram.content).find(n => n.line === row.sourceLine && n.startColumn === node.startColumn);
        if (source && row.revision.nodeRefs[source.id]) { refs[node.id] = row.revision.nodeRefs[source.id]; remap.set(source.id, node.id); }
      }
      // Variant rows carry their own evidence and coordinates; never reuse the base's stale spans.
      const evidence: Record<string, typeof diagram.sourceContext.evidence[string]> = {};
      const mappings = rows.flatMap((row, index) => row.revision.diagram.sourceContext.mappings.filter(m => m.line === row.sourceLine).map(mapping => {
        const entityId = `${row.revision.id}:${mapping.entityId}`;
        evidence[entityId] = { ...row.revision.diagram.sourceContext.evidence[mapping.entityId], id: entityId };
        return { ...mapping, id: `${row.revision.id}:${mapping.id}:${index}`, entityId, line: index + 1 };
      }));
      const byRef = new Map(Object.entries(refs).map(([id, ref]) => [ref, id]));
      const sourceHighlights = [...new Map(rows.flatMap(row => presentationHighlights(row.revision.diagram, document.diagramPresentations?.[contentId], row.revision.nodeRefs)
        .filter(item => !item.textRange).map(item => [item.id, item] as const))).values()];
      const highlights: DiagramHighlight[] = rebaseDiagramHighlights(sourceHighlights, remap).map(({ nodeRefs, ...item }) => {
        const ids = nodeRefs?.map(ref => byRef.get(ref) ?? `stale:${ref}`);
        return ids?.length ? { ...item, ...(item.contentNodeIds ? { contentNodeIds: ids } : { contentNodeId: ids[0] }) } : item;
      });
      // A composed row only inherits a text annotation from its exact source revision.
      rows.forEach((row, index) => {
        for (const item of presentationHighlights(row.revision.diagram, document.diagramPresentations?.[contentId], row.revision.nodeRefs)) {
          const range = item.textRange;
          if (!range || item.revisionId !== row.revision.id || row.sourceLine < range.startLine || row.sourceLine > range.endLine) continue;
          const length = row.revision.diagram.content.ascii.split('\n')[row.sourceLine - 1].length;
          if (!length) continue;
          highlights.push({ ...item, id: `${item.id}:row:${index}`, revisionId: diagram.revisionId,
            textRange: { startLine: index + 1, endLine: index + 1,
              startColumn: row.sourceLine === range.startLine ? range.startColumn : 1,
              endColumn: row.sourceLine === range.endLine ? range.endColumn : length } });
        }
      });
      document.diagramPresentations = { ...document.diagramPresentations, [contentId]: { ...document.diagramPresentations?.[contentId], highlights } };
      document.scene.contents = { ...document.scene.contents, [contentId]: { ...diagram, content, highlights, jumps: [],
        sourceContext: { ...diagram.sourceContext, contentHash: content.asciiSha256, mappings, evidence } } };
    }
    const byRef = new Map(Object.entries(refs).map(([id, ref]) => [ref, id]));
    identities.set(contentId, byRef);
    for (const [id, ref] of Object.entries(revision.nodeRefs)) {
      const target = byRef.get(ref); if (target) replacements.set(`grid:${box.id}:${id}`, target);
    }
  }
  const rebind = (box: GridBox): GridBox => box.kind === 'container' ? { ...box, children: box.children.map(rebind) } : { ...box, contentId: rename.get(box.id)! };
  document.scene.root = rebind(document.scene.root);
  const boxes = new Map(diagramBoxes(document.scene.root).map(box => [`grid:${box.id}`, box]));
  const anchor = (value: DiagramAnchor): DiagramAnchor | undefined => {
    if (value.kind === 'box') return value;
    const box = boxes.get(value.displayNodeId), contentNodeId = replacements.get(`${value.displayNodeId}:${value.contentNodeId}`);
    if (!box || !contentNodeId) return undefined;
    return { ...value, contentNodeId, revisionId: document.scene.contents[box.contentId].content.revisionId };
  };
  document.edges = document.edges.flatMap(edge => {
    const source = anchor(edge.source), target = anchor(edge.target);
    return source?.kind === 'content-node' && target ? [{ ...edge, source, target }] : [];
  });
  // These are already represented by the projected rows. Preview does not offer live navigation.
  document.alternatives = emptyDiagramAlternatives(); document.revisionSelections = {}; document.jumps = [];
  return { state: { document, canvas: structuredClone(snapshot.view) as MappingCanvasState } satisfies ChangeDocumentState, identities };
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
  const diff = diffChangeDocument(doc, correspondence);
  const beforeBoxes = diagramBoxes(before.state.document.scene.root), afterBoxes = diagramBoxes(after.state.document.scene.root);
  const beforeIds = new Set(beforeBoxes.map(box => `grid:${box.id}`)), afterIds = new Set(afterBoxes.map(box => `grid:${box.id}`));
  const removedDiagramIds = new Set([...beforeIds].filter(id => !afterIds.has(id)));
  const modifiedDiagramIds = new Set([...afterIds].filter(id => beforeIds.has(id)));
  // Retain deleted diagrams as ghost boxes in the preview, without restoring them to the canvas.
  const ghosts = beforeBoxes.filter(box => removedDiagramIds.has(`grid:${box.id}`)).map(box => {
    const contentId = `removed:${box.id}:${box.contentId}`;
    const diagram = before.state.document.scene.contents[box.contentId];
    doc.proposed.document.scene.contents = { ...doc.proposed.document.scene.contents, [contentId]: { ...diagram, id: contentId } };
    doc.proposed.document.diagramPresentations = { ...doc.proposed.document.diagramPresentations, [contentId]: before.state.document.diagramPresentations?.[box.contentId] ?? { highlights: diagram.highlights } };
    return { ...box, contentId, collapsedContentId: undefined, collapsed: false };
  });
  if (ghosts.length) {
    const root = doc.proposed.document.scene.root;
    doc.proposed.document.scene.root = { id: `view-root:${comparison.view.id}`, kind: 'container', position: { column: 0, row: 0 },
      collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [root, ...ghosts] };
  }
  return { doc, diff, modifiedDiagramIds, removedDiagramIds };
}
