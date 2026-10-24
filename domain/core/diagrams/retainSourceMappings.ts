import type { Diagram } from './diagram';
import { diagramContentNodes } from './diagramContentNodes';
import { mappingContentNodeId } from '../presentation/diagramText';

/** Identity establishes ownership; an exact, unambiguous text span establishes coordinates. */
export function retainSourceMappings(before: Diagram, after: Diagram, nodeIds: ReadonlyMap<string, string>, lineAfter?: (line: number) => number | undefined) {
  const nodes = new Map(diagramContentNodes(after.content).map(node => [node.id, node]));
  const oldLines = before.content.ascii.split('\n'), newLines = after.content.ascii.split('\n');
  return before.sourceContext.mappings.flatMap(mapping => {
    const owner = mappingContentNodeId(before.content, mapping), next = owner && nodeIds.get(owner);
    if (owner) {
      const node = next && nodes.get(next);
      if (!node) return [];
      const text = oldLines[mapping.line - 1].slice(mapping.startColumn - 1, mapping.endColumn);
      const label = newLines[node.line - 1].slice(node.startColumn - 1, node.endColumn);
      const offset = label.indexOf(text);
      if (!text.trim() || offset < 0 || label.indexOf(text, offset + 1) >= 0) return [];
      return [{ ...mapping, line: node.line, startColumn: node.startColumn + offset, endColumn: node.startColumn + offset + text.length - 1 }];
    }
    const line = lineAfter?.(mapping.line) ?? (before.content.ascii === after.content.ascii ? mapping.line : undefined);
    return line && oldLines[mapping.line - 1] === newLines[line - 1] ? [{ ...mapping, line }] : [];
  });
}
