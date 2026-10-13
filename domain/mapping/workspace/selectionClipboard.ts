import { formatAsciiWithCodeReferences } from '../../core/diagrams/diagramClipboard';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import type { Diagram } from '../../core/diagrams/lineGrid';
import type { MappingPocGridRect } from '../selection/mappingPoc';
import { diagramSelectionNodes } from './mappingDocument';

/** Copy complete selected rows, preserving indentation, plus the selected code refs. */
export function selectionClipboardText(diagram: Diagram, rect: MappingPocGridRect | null, selectedIds: readonly string[], contentNodeIds?: readonly string[]): string | null {
  if (!rect) return null;
  const ids = new Set(selectedIds);
  const references = diagramSelectionNodes(diagram).filter(node => ids.has(node.id)).flatMap(node =>
    node.sourceRanges.map(range => `${node.label}: ${range.path}:${range.startLine}-${range.endLine}`));
  return formatAsciiWithCodeReferences([selectionExcerpt(diagram, rect, contentNodeIds)], references);
}

/** Explicit holes in a selection must not reappear in copied or generated context. */
export function selectionExcerpt(diagram: Diagram, rect: MappingPocGridRect, contentNodeIds?: readonly string[]): string {
  const nodes = diagramContentNodes(diagram.content), ids = contentNodeIds && new Set(contentNodeIds);
  const hasHoles = ids && nodes.some(node => node.line >= rect.startLine && node.line <= rect.endLine
    && node.startColumn <= rect.endColumn && node.endColumn >= rect.startColumn && !ids.has(node.id));
  if (!hasHoles) return diagram.content.ascii.split('\n').slice(rect.startLine - 1, rect.endLine)
    .map(line => line.replace(/\r$/, '')).join('\n');
  const byId = new Map(nodes.map(node => [node.id, node])), lines = diagram.content.ascii.split('\n');
  return contentNodeIds!.flatMap(id => {
    const node = byId.get(id);
    return node ? [lines[node.line - 1].slice(node.startColumn - 1, node.endColumn)] : [];
  }).join('\n');
}
