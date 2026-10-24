import { projectSelectedDiagramRows } from '../../core/presentation/diagramRevisionProjection';
import { resolveRevisionLines } from '../../core/diagrams/diagramRevisionSelection';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { getDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import { diagramNode, type DiagramNode, type DiagramPresentation } from '../../core/diagrams/diagramNode';
import { presentationHighlights } from '../../core/presentation/diagramPresentation';
import { endpointKey, type EndpointBounds } from './endpointGeometry';
import { presentationScene, resolveDiagramContent, projectDiagramContent, resolveDiagramView } from './diagramViewState';
export { resolveDiagramContent } from './diagramViewState';
import { flattenGrid, resolveScene, type GridBounds } from '../../core/diagrams/lineGrid';
import type { DiagramContent } from '../../core/diagrams/diagramContent';
import type { FloatingBox, DisplayGeometry } from './displayModel';
import type { MappingGridDocument } from './mappingGrid';
import type { MappingCanvasState } from './mappingWorkspace';
import { drawEdge, resolveEndpoint, spaceEdgeArrows } from './connectionLayout';
import { connectionContentNodes } from '../../core/diagrams/diagramConnection';
import { connectionObstacles, sceneRoutingObstacles } from './routingObstacles';
export type { FloatingBox };

export type FloatingPlacement =
  | { kind: 'connection'; edgeId: string }
  | { kind: 'grid-region'; gridBoxId: string; contentId: string; rect: import('../selection/mappingPoc').MappingPocGridRect; sourceAscii: string }
  | { kind: 'parent'; ownerId: string }
  | { kind: 'conversation'; canvasAnchor: { x: number; y: number }; presentation: 'compact' | 'floating' | 'docked' }
  | { kind: 'stored'; coordinateSpace: 'canvas' | 'viewport' };
export interface DisplayNodeCollapsible {
  self: boolean;
  subtrees: {
    contentNodeId: string; label: string; line: number; branchColumn: number;
    /** Zero-based row in the folded rendering; absent when hidden by an ancestor. */
    visibleRow?: number;
    expansion: 'expanded' | 'collapsed';
  }[];
}
export type CanvasDisplayNode = {
  presentationSettings?: import('../../core/presentation/diagramPresentation').DiagramPresentationSettings;
  textRows?: readonly import('../../core/presentation/diagramText').DiagramTextRow[];
  domainNode?: DiagramNode; presentation?: DiagramPresentation;
  id: string; version: number; childIds: string[]; expansion: 'expanded' | 'collapsed';
  collapsible: DisplayNodeCollapsible;
} & ({ layout: 'grid'; kind: 'diagram' | 'group'; boxId: string; geometry: { units: 'cells'; bounds: GridBounds }; content?: DiagramContent; nodeRefs?: Readonly<Record<string, string>>; contentNodes?: readonly import('../../core/diagrams/diagramContent').DiagramContentNode[]; diagram?: import("../../core/diagrams/diagram").Diagram }
  | { layout: 'floating'; kind: FloatingBox['kind']; geometry: DisplayGeometry & { units: 'pixels' }; placement: FloatingPlacement; value: FloatingBox });
export const gridNodeId = (id: string) => `grid:${id}`;
export const floatingNodeId = (id: string) => `floating:${id}`;

/** Read-only registry over the two existing stores. Geometry has no second writable copy. */
export function canvasDisplayNodes(document: MappingGridDocument, canvas: MappingCanvasState, version: number, cell = { width: 8, height: 18 }, endpointBounds?: EndpointBounds): CanvasDisplayNode[] {
  const visible = new Map(flattenGrid(resolveDiagramView(presentationScene(document), canvas.diagramViews)).map(node => [node.box.id, node]));
  const expand = (box: typeof document.scene.root): typeof box => box.kind === 'container'
    ? { ...box, collapsed: false, children: box.children.map(expand) } : { ...box, collapsed: false };
  const expanded = flattenGrid(resolveScene({ ...document.scene, root: expand(document.scene.root) }));
  const grid: CanvasDisplayNode[] = expanded.map(node => {
    const box = findBox(document.scene.root, node.box.id)!;
    const content = box.kind === 'diagram' ? document.scene.contents[box.contentId] : undefined;
    const parsed = content && resolveDiagramContent(content);
    const view = canvas.diagramViews?.[gridNodeId(box.id)];
    const projection = parsed && projectDiagramContent(parsed, view);
    const revision = content && getDiagramRevision(content.revisionId);
    const collapsedRefs = new Set([...(view?.collapsedNodeRefs ?? []), ...(view && view.contentRevisionId === parsed?.revisionId ? view.collapsedContentNodeIds : []).flatMap(id => revision?.nodeRefs[id] ? [revision.nodeRefs[id]] : [])]);
    const selected = revision && Object.values(document.revisionSelections ?? {}).some(selection => selection.contentId === content!.id);
    const selectedLines = selected ? resolveRevisionLines(revision, document, getDiagramRevision, collapsedRefs) : undefined;
    const selectedNodes = new Map<string, Map<number, import('../../core/diagrams/diagramContent').DiagramContentNode>>();
    const selectedSubtrees = selectedLines?.flatMap((line, visibleRow) => {
      if (!selectedNodes.has(line.revision.id)) selectedNodes.set(line.revision.id, new Map(diagramContentNodes(line.revision.diagram.content).map(node => [node.line, node])));
      const item = selectedNodes.get(line.revision.id)!.get(line.sourceLine);
      return item?.childIds.length ? [{ contentNodeId: item.id, label: item.label, line: item.line, branchColumn: item.branchColumn, visibleRow,
        expansion: collapsedRefs.has(line.nodeRef!) ? 'collapsed' as const : 'expanded' as const }] : [];
    });
    return { collapsible: { self: box.id !== document.scene.root.id, subtrees: selectedSubtrees ?? (parsed?.structure.kind === 'tree' ? Object.values(parsed.structure.nodes).filter(item => item.childIds.length).map(item => ({
      contentNodeId: item.id, label: item.label, line: item.line, branchColumn: item.branchColumn, visibleRow: projection!.rowForLine(item.line),
      expansion: view?.contentRevisionId === parsed.revisionId && view.collapsedContentNodeIds.includes(item.id) ? 'collapsed' as const : 'expanded' as const
    })) : []) }, id: gridNodeId(box.id), boxId: box.id, version, layout: 'grid', kind: box.kind === 'diagram' ? 'diagram' : 'group',
      childIds: box.kind === 'container' ? box.children.map(child => gridNodeId(child.id)) : [], expansion: box.collapsed ? 'collapsed' : 'expanded',
      geometry: { units: 'cells', bounds: visible.get(box.id)?.bounds ?? node.bounds },
      ...(content ? (() => {
        const refs = getDiagramRevision(content.revisionId).nodeRefs;
        const highlights = presentationHighlights(content, document.diagramPresentations?.[content.id], refs);
        const domainNode = diagramNode(gridNodeId(box.id), content);
        const bounds = visible.get(box.id)?.bounds ?? node.bounds;
        const presentation: DiagramPresentation = { id: domainNode.id, nodeId: domainNode.id,
          geometry: { coordinateSpace: 'canvas', position: { x: bounds.column * cell.width, y: bounds.row * cell.height }, bounds: { width: bounds.columns * cell.width, height: bounds.rows * cell.height } },
          view: { display: view?.display ?? 'regular', baseRevisionId: view?.baseRevisionId, collapsed: box.collapsed, collapsedNodeRefs: [...collapsedRefs], highlights } };
        const textRows = selected
          ? projectSelectedDiagramRows(revision!, document, domainNode.id, getDiagramRevision, document.diagramPresentations?.[content.id], collapsedRefs) : undefined;
        return { domainNode, presentation, textRows, presentationSettings: document.diagramPresentations?.[content.id], content: content.content, contentNodes: connectionContentNodes(content.content), nodeRefs: refs,
          diagram: highlights === content.highlights ? content : { ...content, highlights } };
      })() : {}) };
  });
  const floating: CanvasDisplayNode[] = Object.values(canvas.display.nodes).map(node => {
    const owner = Object.values(canvas.display.nodes).find(parent => parent.childIds.includes(node.id));
    const placement: FloatingPlacement = node.kind === 'selection' && node.geometryPolicy.placement === 'automatic'
      ? { kind: 'grid-region', gridBoxId: gridNodeId(node.sourceBoxId), contentId: node.sourceContentId, rect: node.rect, sourceAscii: node.sourceAscii }
      : node.kind === 'conversation' ? { kind: 'conversation', canvasAnchor: node.canvasAnchor, presentation: node.presentation }
      : node.kind === 'projection' && owner && node.geometryPolicy.placement === 'automatic'
        ? { kind: 'parent', ownerId: floatingNodeId(owner.id) } : { kind: 'stored', coordinateSpace: node.coordinateSpace };
    return { collapsible: { self: true, subtrees: [] }, id: floatingNodeId(node.id), version, layout: 'floating', kind: node.kind,
      childIds: node.childIds.map(floatingNodeId), expansion: node.expansion,
      geometry: { units: 'pixels', position: node.position, bounds: node.bounds, coordinateSpace: node.coordinateSpace }, placement, value: node };
  });
  const obstacles = document.edges?.length ? sceneRoutingObstacles(document.scene, canvas.diagramViews, cell) : [];
  const spaced = spaceEdgeArrows((document.edges ?? []).map(edge => {
    const a = resolveEndpoint(document.scene, canvas.diagramViews, edge.source, cell);
    const b = resolveEndpoint(document.scene, canvas.diagramViews, edge.target, cell, true);
    return { arrow: drawEdge(edge, document.scene, canvas.diagramViews, cell, endpointBounds, obstacles),
      obstacles: [...connectionObstacles(obstacles, a?.identity, b?.identity), ...[a, b].flatMap(endpoint => endpoint
        ? [(!endpoint.labelRect && endpointBounds?.[endpointKey(endpoint.identity)]) || endpoint.rect] : [])] };
  }));
  const arrows: CanvasDisplayNode[] = spaced.map(value => {
    return { id: `floating:${value.id}`, version, childIds: [], expansion: 'expanded', collapsible: { self: false, subtrees: [] },
      layout: 'floating', kind: 'arrow', geometry: { units: 'pixels', position: value.position, bounds: value.bounds, coordinateSpace: 'canvas' },
      placement: { kind: 'connection', edgeId: value.edgeId }, value };
  });
  return structuredClone([...grid, ...floating, ...arrows]);
}
export function findBox(box: import('../../core/diagrams/lineGrid').GridBox, id: string): typeof box | undefined {
  if (box.id === id) return box;
  return box.kind === 'container' ? box.children.map(child => findBox(child, id)).find(Boolean) : undefined;
}
