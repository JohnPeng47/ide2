import type { NodeRelationship } from '../../core/nodes/node';
import { diagramNode, type DiagramNode } from '../../core/diagrams/diagramNode';
import type { MappingGridDocument } from './mappingGrid';
import type { GridBox } from '../../core/diagrams/lineGrid';

/** Content containers and their relationships, without geometry or renderer state. */
export function canvasNodeGraph(document: MappingGridDocument): { nodes: DiagramNode[]; relationships: NodeRelationship[] } {
  const nodes: DiagramNode[] = [];
  const visit = (box: GridBox) => {
    if (box.kind === 'container') box.children.forEach(visit);
    else nodes.push(diagramNode(`grid:${box.id}`, document.scene.contents[box.contentId]));
  };
  visit(document.scene.root);
  return { nodes, relationships: document.edges.map(edge => ({ id: edge.id, kind: 'connection',
    sourceNodeId: edge.source.displayNodeId, targetNodeId: edge.target.displayNodeId })) };
}
