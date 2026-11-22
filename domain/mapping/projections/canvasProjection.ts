import type { ProjectionType } from './projectionType';
import type { ResolvedCanvasDocument } from '../../core/diagrams/canvasHistory';
import { getArrowLabel, type DiagramAnchor } from '../../core/diagrams/diagramConnection';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import type { DiagramContentNode } from '../../core/diagrams/diagramContent';
import type { DiagramRevision } from '../../core/diagrams/diagramRevision';
import { getDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import { presentationHighlights } from '../../core/presentation/diagramPresentation';
import { resolveScene, type GridBounds, type GridBox, type GridPoint, type ResolvedGridBox } from '../../core/diagrams/lineGrid';
import { resolveCanvasPresentation } from './resolveCanvasPresentation';

export function projectCanvas(source: ResolvedCanvasDocument, projectionType: ProjectionType,
  revisions?: Readonly<Record<string, DiagramRevision>>, nodeIds?: readonly string[]) {
  const revisionById = revisions ? (id: string) => revisions[id] : getDiagramRevision;
  const selected = Object.values(source.alternatives?.selected ?? {}).some(ids => ids.length) || Object.keys(source.revisionSelections ?? {}).length;
  const presentation = selected ? resolveCanvasPresentation(source, revisionById) : undefined;
  const document = presentation?.document ?? source;
  const bounds = new Map<string, GridBounds>();
  function indexGeometry(node: ResolvedGridBox) {
    bounds.set(node.box.id, node.bounds);
    node.children.forEach(indexGeometry);
  }
  if (projectionType !== 'graph') indexGeometry(resolveScene(document.scene));

  const instances = new Map<string, GridBox>();
  const filter = nodeIds && new Set(nodeIds);
  const groups: { id: string; parentId?: string; collapsed: boolean; position: GridPoint; bounds?: GridBounds }[] = [];
  const nodes: ReturnType<typeof diagramNode>[] = [];
  const anchors = new Map<string, Map<string, DiagramContentNode>>();
  function diagramNode(box: Extract<GridBox, {kind: 'diagram'}>, parentId: string | undefined, position: GridPoint) {
    const diagram = document.scene.contents[box.contentId];
    const id = 'grid:' + box.id;
    const node = { id, ascii: diagram.content.ascii };
    if (projectionType === 'graph') return node;
    const layout = { ...node, parentId, position, bounds: bounds.get(box.id), collapsed: box.collapsed };
    if (projectionType === 'layout') return layout;
    const refs = presentation?.identities.get(box.contentId);
    const nodeRefs = refs ? Object.fromEntries([...refs].map(([ref, key]) => [key, ref])) : revisionById(diagram.revisionId).nodeRefs;
    return { ...layout, diagramId: diagram.diagramId, revisionId: diagram.revisionId, contentRevisionId: diagram.content.revisionId,
      anchors: diagramContentNodes(diagram.content).map(anchor => ({ ...anchor, nodeRef: nodeRefs[anchor.id] })),
      sourceContext: diagram.sourceContext, jumps: diagram.jumps ?? [],
      highlights: presentationHighlights(diagram, document.diagramPresentations?.[box.contentId], nodeRefs) ?? [] };
  }
  function visit(box: GridBox, origin: GridPoint, parentId?: string) {
    const id = 'grid:' + box.id;
    instances.set(id, box);
    const position = { column: origin.column + box.position.column, row: origin.row + box.position.row };
    if (box.kind === 'diagram') {
      if (!filter || filter.has(id)) nodes.push(diagramNode(box, parentId, position));
    } else {
      if (projectionType !== 'graph') groups.push({ id, parentId, position, bounds: bounds.get(box.id), collapsed: box.collapsed });
      box.children.forEach(child => visit(child, position, id));
    }
  }
  visit(document.scene.root, { column: 0, row: 0 });
  function endpoint(anchor: DiagramAnchor, key: string) {
    const node = anchor.displayNodeId, box = instances.get(node);
    if (!box) return { node, status: 'missing' };
    if (box.kind === 'container') return { node, kind: 'container' };
    if (filter && !filter.has(node)) return { node, status: 'excluded' };
    if (anchor.kind === 'box') return { node };
    const content = document.scene.contents[box.contentId].content;
    if (anchor.revisionId !== content.revisionId || presentation?.unresolved.has(key)) return { node, status: 'stale' };
    let index = anchors.get(box.contentId);
    if (!index) {
      index = new Map(diagramContentNodes(content).map(a => [a.id, a]));
      anchors.set(box.contentId, index);
    }
    const location = index.get(anchor.contentNodeId);
    return location ? { node, line: location.line, column: location.startColumn } : { node, status: 'stale' };
  }
  const edges = document.edges.filter(edge => !filter || filter.has(edge.source.displayNodeId) || filter.has(edge.target.displayNodeId))
    .map(edge => ({ ...(projectionType === 'detail' ? { id: edge.id } : {}),
      source: endpoint(edge.source, edge.id + ':source'), target: endpoint(edge.target, edge.id + ':target'), label: getArrowLabel(edge.appearance).text }));
  return projectionType === 'graph' ? { nodes, edges } : { nodes, edges, groups };
}
