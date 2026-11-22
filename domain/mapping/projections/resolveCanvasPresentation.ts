import { alternativeSelections, emptyDiagramAlternatives } from '../../core/presentation/diagramAlternative';
import { presentationHighlights } from '../../core/presentation/diagramPresentation';
import { rebaseDiagramHighlights, type DiagramHighlight } from '../../core/diagrams/diagramHighlight';
import type { ResolvedCanvasDocument } from '../../core/diagrams/canvasHistory';
import type { DiagramRevision } from '../../core/diagrams/diagramRevision';
import { buildDiagramContent, contentParserVersion } from '../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { resolveRevisionLines } from '../../core/diagrams/diagramRevisionSelection';
import type { DiagramAnchor } from '../../core/diagrams/diagramConnection';
import type { GridBox } from '../../core/diagrams/lineGrid';

const diagramBoxes = (root: GridBox, origin = { column: 0, row: 0 }): Extract<GridBox, { kind: 'diagram' }>[] => {
  const position = { column: origin.column + root.position.column, row: origin.row + root.position.row };
  return root.kind === 'diagram' ? [{ ...root, position }] : root.children.flatMap(child => diagramBoxes(child, position));
};

/** Rendering projection only: never issues revisions or changes the stored selection. */
export function resolveCanvasPresentation(source: ResolvedCanvasDocument, revisionById: (id: string) => DiagramRevision) {
  const document = structuredClone(source);
  const identities = new Map<string, Map<string, string>>();
  const replacements = new Map<string, string>();
  const placements = diagramBoxes(document.scene.root);
  const rename = new Map<string, string>();
  for (const box of placements) {
    const originalContentId = box.contentId;
    const contentId = placements.filter(other => other.contentId === originalContentId).length > 1 ? `placement:${box.id}:${originalContentId}` : originalContentId;
    const diagram = { ...source.scene.contents[originalContentId], id: contentId };
    rename.set(box.id, contentId);
    document.scene.contents = { ...document.scene.contents, [contentId]: diagram };
    if (document.diagramPresentations?.[originalContentId]) document.diagramPresentations[contentId] = document.diagramPresentations[originalContentId];
    const revision = revisionById(diagram.revisionId);
    const choices = alternativeSelections(document, `grid:${box.id}`, originalContentId, revision);
    const hasSelection = Object.values(choices.revisionSelections ?? {}).some(selection => selection.contentId === originalContentId);
    let refs: Record<string, string> = { ...revision.nodeRefs };
    if (hasSelection) {
      const rows = resolveRevisionLines(revision, choices, revisionById);
      const ascii = rows.map(row => row.revision.diagram.content.ascii.split('\n')[row.sourceLine - 1]).join('\n');
      const structure = rows[0]?.revision.diagram.content.structure ?? diagram.content.structure;
      const content = buildDiagramContent(ascii, diagram.content.revisionId, structure.kind, contentParserVersion(structure));
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
  const placementsById = new Map(placements.map(box => [`grid:${box.id}`, box]));
  const anchor = (value: DiagramAnchor): DiagramAnchor | undefined => {
    if (value.kind === 'box') return value;
    const box = boxes.get(value.displayNodeId), contentNodeId = replacements.get(`${value.displayNodeId}:${value.contentNodeId}`);
    const original = placementsById.get(value.displayNodeId);
    if (!box || !contentNodeId || !original || source.scene.contents[original.contentId].content.revisionId !== value.revisionId) return undefined;
    return { ...value, contentNodeId, revisionId: document.scene.contents[box.contentId].content.revisionId };
  };
  const unresolved = new Set<string>();
  document.edges = document.edges.map(edge => {
    const source = anchor(edge.source), target = anchor(edge.target);
    if (!source) unresolved.add(edge.id + ':source');
    if (!target) unresolved.add(edge.id + ':target');
    return { ...edge, source: source?.kind === 'content-node' ? source : edge.source, target: target ?? edge.target };
  });
  // These are already represented by the projected rows. Preview does not offer live navigation.
  document.alternatives = emptyDiagramAlternatives(); document.revisionSelections = {}; document.jumps = [];
  return { document, identities, unresolved };
}
