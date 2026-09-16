import { flattenGrid, resolveScene, type GridBounds } from '../../core/diagrams/lineGrid';
import { buildDiagramContent, type DiagramContent } from '../../core/diagrams/diagramContent';
import type { FloatingBox, DisplayGeometry } from './displayModel';
import type { MappingGridDocument } from './mappingGrid';
import type { MappingCanvasState } from './mappingWorkspace';
export type { FloatingBox };

export type FloatingPlacement =
  | { kind: 'grid-region'; gridBoxId: string; contentId: string; rect: import('../selection/mappingPoc').MappingPocGridRect; sourceAscii: string }
  | { kind: 'parent'; ownerId: string }
  | { kind: 'conversation'; canvasAnchor: { x: number; y: number }; presentation: 'compact' | 'floating' | 'docked' }
  | { kind: 'stored'; coordinateSpace: 'canvas' | 'viewport' };
export type CanvasDisplayNode = {
  id: string; version: number; childIds: string[]; expansion: 'expanded' | 'collapsed';
} & ({ layout: 'grid'; kind: 'diagram' | 'group'; boxId: string; geometry: { units: 'cells'; bounds: GridBounds }; content?: DiagramContent }
  | { layout: 'floating'; kind: FloatingBox['kind']; geometry: DisplayGeometry & { units: 'pixels' }; placement: FloatingPlacement; value: FloatingBox });
export const gridNodeId = (id: string) => `grid:${id}`;
export const floatingNodeId = (id: string) => `floating:${id}`;

/** Read-only registry over the two existing stores. Geometry has no second writable copy. */
export function canvasDisplayNodes(document: MappingGridDocument, canvas: MappingCanvasState, version: number): CanvasDisplayNode[] {
  const visible = new Map(flattenGrid(resolveScene(document.scene)).map(node => [node.box.id, node]));
  const expand = (box: typeof document.scene.root): typeof box => box.kind === 'container'
    ? { ...box, collapsed: false, children: box.children.map(expand) } : { ...box, collapsed: false };
  const expanded = flattenGrid(resolveScene({ ...document.scene, root: expand(document.scene.root) }));
  const grid: CanvasDisplayNode[] = expanded.map(node => {
    const box = findBox(document.scene.root, node.box.id)!;
    const content = box.kind === 'diagram' ? document.scene.contents[box.contentId] : undefined;
    return { id: gridNodeId(box.id), boxId: box.id, version, layout: 'grid', kind: box.kind === 'diagram' ? 'diagram' : 'group',
      childIds: box.kind === 'container' ? box.children.map(child => gridNodeId(child.id)) : [], expansion: box.collapsed ? 'collapsed' : 'expanded',
      geometry: { units: 'cells', bounds: visible.get(box.id)?.bounds ?? node.bounds },
      ...(content ? { content: resolveDiagramContent(content) } : {}) };
  });
  const floating: CanvasDisplayNode[] = Object.values(canvas.display.nodes).map(node => {
    const owner = Object.values(canvas.display.nodes).find(parent => parent.childIds.includes(node.id));
    const placement: FloatingPlacement = node.kind === 'selection' && node.geometryPolicy.placement === 'automatic'
      ? { kind: 'grid-region', gridBoxId: gridNodeId(node.sourceBoxId), contentId: node.sourceContentId, rect: node.rect, sourceAscii: node.sourceAscii }
      : node.kind === 'conversation' ? { kind: 'conversation', canvasAnchor: node.canvasAnchor, presentation: node.presentation }
      : node.kind === 'projection' && owner && node.geometryPolicy.placement === 'automatic'
        ? { kind: 'parent', ownerId: floatingNodeId(owner.id) } : { kind: 'stored', coordinateSpace: node.coordinateSpace };
    return { id: floatingNodeId(node.id), version, layout: 'floating', kind: node.kind,
      childIds: node.childIds.map(floatingNodeId), expansion: node.expansion,
      geometry: { units: 'pixels', position: node.position, bounds: node.bounds, coordinateSpace: node.coordinateSpace }, placement, value: node };
  });
  return structuredClone([...grid, ...floating]);
}
export function findBox(box: import('../../core/diagrams/lineGrid').GridBox, id: string): typeof box | undefined {
  if (box.id === id) return box;
  return box.kind === 'container' ? box.children.map(child => findBox(child, id)).find(Boolean) : undefined;
}

const contentCache = new WeakMap<import('../../core/diagrams/lineGrid').CanvasDiagram, DiagramContent>();
export function resolveDiagramContent(content: import('../../core/diagrams/lineGrid').CanvasDiagram): DiagramContent {
  let parsed = contentCache.get(content);
  if (!parsed) {
    parsed = buildDiagramContent(content.ascii, `${content.id}:${content.revision}`, content.structureKind ?? content.diagramContent?.structure.kind ?? 'diagram', content.mappings);
    contentCache.set(content, parsed);
  }
  return parsed;
}
