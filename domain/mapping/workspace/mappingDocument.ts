import type { LineGridScene } from '../../core/diagrams/lineGrid';
import { diagramSource } from '../../core/diagrams/diagram';
import type { MappingGridDocument } from './mappingGrid';
import type { MappingPocANode } from '../selection/mappingPoc';
export function mappingDocumentFromScene(scene: LineGridScene, edges: MappingGridDocument['edges'] = []): MappingGridDocument {
  return { scene, sections: {}, edges };
}
/** Selection annotations are computed on demand and never stored in the canvas document. */
export function diagramSelectionNodes(diagram: import('../../core/diagrams/diagram').Diagram): MappingPocANode[] {
  return diagramSource(diagram).entries().map(({mapping,entity,range}) => ({
    id: `${diagram.id}:${mapping.id}`, label: entity?.label ?? mapping.entityId,
    head: { line: mapping.line, startColumn: mapping.startColumn, endColumn: mapping.endColumn },
    extent: { startLine: mapping.line, endLine: mapping.line }, selectableBecause: 'mapped',
    sourceRanges: range ? [range] : [], mappedBNodeIds: []
  }));
}
