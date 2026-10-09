import { createShapeId, type TLShapePartial } from 'tldraw';
import { flattenGrid, resolveScene } from '../../../../domain/core/diagrams/lineGrid';
import { visibleProjectionIds } from '../../../../domain/mapping/workspace/displayModel';
import type { ControllerSnapshot } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { MappingShape } from './MappingShapeUtil';

export const mappingShapeId = (nodeId: string) => createShapeId(`mapping:${nodeId}`);
export const DEFAULT_CELL = { width: 8.4, height: 18 };
/** Import/command projection. Pointer movement never runs the legacy layout renderer. */
export function projectMappingShapes(snapshot: ControllerSnapshot): TLShapePartial<MappingShape>[] {
  const { document, canvas } = snapshot;
  const cell = snapshot.cell?.width ? snapshot.cell : DEFAULT_CELL;
  const boxes = flattenGrid(resolveScene(document.scene));
  const shapes: TLShapePartial<MappingShape>[] = boxes.map(box => {
    const parent = boxes.find(parent => parent.box.id !== document.scene.root.id && parent.children.some(child => child.box.id === box.box.id));
    return ({
    id: mappingShapeId(`grid:${box.box.id}`), type: 'mapping-box',
    x: (box.bounds.column - (parent?.bounds.column ?? 0)) * cell.width, y: (box.bounds.row - (parent?.bounds.row ?? 0)) * cell.height,
    ...(parent ? { parentId: mappingShapeId(`grid:${parent.box.id}`) } : {}),
    isLocked: box.box.kind === 'container' && box.box.id === document.scene.root.id,
    props: { nodeId: `grid:${box.box.id}`, kind: box.box.kind, revisionId: box.contentId ? document.scene.contents[box.contentId].revisionId : '',
      w: Math.max(1, box.bounds.columns * cell.width), h: Math.max(1, box.bounds.rows * cell.height) },
  }); });
  const visible = new Set<string>();
  for (const node of Object.values(canvas.display.nodes)) {
    if (node.kind === 'detail' || node.kind === 'conversation') visible.add(node.id);
    if (node.kind === 'selection') {
      const source = boxes.find(box => box.box.id === node.sourceBoxId);
      if (source?.box.collapsed) continue;
      if (node.childIds.length || canvas.selection.items.some(item => item.id === node.id)) visible.add(node.id);
      visibleProjectionIds(canvas.display, node.id, node.displayMode).forEach(id => visible.add(id));
    }
  }
  for (const node of Object.values(canvas.display.nodes)) {
    if (!visible.has(node.id) || node.coordinateSpace === 'viewport' && node.kind !== 'conversation') continue;
    if (node.kind === 'projection' && (node.content.kind === 'code-panel' || node.content.kind === 'source-code')) continue;
    const bubble = node.kind === 'conversation' && (node.expansion === 'collapsed' || node.presentation === 'docked');
    shapes.push({ id: mappingShapeId(`floating:${node.id}`), type: 'mapping-box', isLocked: node.kind === 'selection', x: bubble ? node.canvasAnchor.x : node.position.x,
      y: bubble ? node.canvasAnchor.y : node.position.y,
      props: { nodeId: `floating:${node.id}`, kind: node.kind, revisionId: '',
        w: bubble ? 36 : Math.max(1, node.bounds.width), h: bubble ? 36 : Math.max(1, node.bounds.height) } });
  }
  for (const edge of document.edges) shapes.push({ id: mappingShapeId(`floating:edge:${edge.id}`), type: 'mapping-box', x: 0, y: 0, isLocked: true,
    props: { nodeId: `floating:edge:${edge.id}`, kind: 'arrow', revisionId: '', w: 1, h: 1 } });
  return shapes;
}
