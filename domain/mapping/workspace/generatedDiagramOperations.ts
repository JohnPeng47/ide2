import type { DiagramCreation } from '../agent/diagramEdit';
import type { DiagramOperation } from './mappingDocumentController';

/** Install generated diagrams and extension edges in a single undoable transaction. */
export function generatedDiagramOperations(diagrams: readonly DiagramCreation[]): DiagramOperation[] {
  return [
    ...diagrams.map(diagram => ({ method: 'diagram-create', id: diagram.id, parentId: diagram.parentId,
      position: diagram.position, ...diagram.content }) as DiagramOperation),
    ...diagrams.flatMap(diagram => (diagram.sources ?? []).map((source, index): DiagramOperation => ({ method: 'edge-create',
      edge: { id: `${diagram.id}-extension-${index}`, source, target: { kind: 'box', displayNodeId: `grid:${diagram.id}`, side: 'auto' },
        appearance: { color: '#88c0d0', lineStyle: 'solid', label: '' } } })))
  ];
}
