import { formatAsciiWithCodeReferences } from '../../core/diagrams/diagramClipboard';
import { asciiForSelection } from '../../core/diagrams/diagramSelection';
import type { Diagram, GridBox } from '../../core/diagrams/lineGrid';
import type { MappingPocGridRect } from '../selection/mappingPoc';
import { diagramSelectionNodes } from './mappingDocument';
import type { MappingGridDocument } from './mappingGrid';
import type { MappingControls } from './mappingWorkspace';

/** Exact payload of the canvas Copy ASCII + code refs action. No clipboard access. */
export function selectionClipboardText(diagram: Diagram, rect: MappingPocGridRect | null, selectedIds: readonly string[]): string | null {
  if (!rect) return null;
  const ids = new Set(selectedIds);
  const references = diagramSelectionNodes(diagram).filter(node => ids.has(node.id)).flatMap(node =>
    node.sourceRanges.map(range => `${node.label}: ${range.path}:${range.startLine}-${range.endLine}`));
  return formatAsciiWithCodeReferences([asciiForSelection(diagram.content.ascii, rect)], references);
}

/** Same active-diagram fallback as the canvas UI, without computing layout or history. */
export function selectionDiagram(document: MappingGridDocument, controls: MappingControls): Diagram | undefined {
  let first: Diagram | undefined, active: Diagram | undefined;
  const visit = (box: GridBox) => {
    if (box.kind === 'container') box.children.forEach(visit);
    else {
      first ??= document.scene.contents[box.contentId];
      if (box.id === controls.activeBoxId) active = document.scene.contents[box.contentId];
    }
  };
  visit(document.scene.root);
  return active ?? first;
}
