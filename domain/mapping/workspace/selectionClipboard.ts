import { formatAsciiWithCodeReferences } from '../../core/diagrams/diagramClipboard';
import { asciiForSelection } from '../../core/diagrams/diagramSelection';
import type { Diagram } from '../../core/diagrams/lineGrid';
import type { MappingPocGridRect } from '../selection/mappingPoc';
import { diagramSelectionNodes } from './mappingDocument';

/** Exact payload of the canvas Copy ASCII + code refs action. No clipboard access. */
export function selectionClipboardText(diagram: Diagram, rect: MappingPocGridRect | null, selectedIds: readonly string[]): string | null {
  if (!rect) return null;
  const ids = new Set(selectedIds);
  const references = diagramSelectionNodes(diagram).filter(node => ids.has(node.id)).flatMap(node =>
    node.sourceRanges.map(range => `${node.label}: ${range.path}:${range.startLine}-${range.endLine}`));
  return formatAsciiWithCodeReferences([asciiForSelection(diagram.content.ascii, rect)], references);
}
