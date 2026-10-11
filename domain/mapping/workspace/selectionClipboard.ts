import { formatAsciiWithCodeReferences } from '../../core/diagrams/diagramClipboard';
import type { Diagram } from '../../core/diagrams/lineGrid';
import type { MappingPocGridRect } from '../selection/mappingPoc';
import { diagramSelectionNodes } from './mappingDocument';

/** Copy complete selected rows, preserving indentation, plus the selected code refs. */
export function selectionClipboardText(diagram: Diagram, rect: MappingPocGridRect | null, selectedIds: readonly string[]): string | null {
  if (!rect) return null;
  const ids = new Set(selectedIds);
  const references = diagramSelectionNodes(diagram).filter(node => ids.has(node.id)).flatMap(node =>
    node.sourceRanges.map(range => `${node.label}: ${range.path}:${range.startLine}-${range.endLine}`));
  const rows = diagram.content.ascii.split('\n')
    .slice(rect.startLine - 1, rect.endLine)
    .map(line => line.replace(/\r$/, ''))
    .join('\n');
  return formatAsciiWithCodeReferences([rows], references);
}
