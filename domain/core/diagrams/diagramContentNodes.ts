import type { DiagramContent, DiagramContentNode } from './diagramContent';
import { parseDiagram } from './interpreter';

// A derived index lets existing unstructured diagrams expose anchors without rewriting their content.
const indexes = new WeakMap<DiagramContent, readonly DiagramContentNode[]>();
export function diagramContentNodes(content: DiagramContent): readonly DiagramContentNode[] {
  if (content.structure.kind === 'tree') return Object.values(content.structure.nodes);
  const cached = indexes.get(content);
  if (cached) return cached;
  const parsed = parseDiagram(content.ascii, { dialect: 'mixed', repairs: 'none', continuation: 'separate' });
  const scoped = (id: string) => `${content.revisionId}:${content.asciiSha256}:${id}`;
  const nodes = parsed.nodes.filter(node => node.spans.length).map(node => ({
    id: scoped(node.id), label: node.label, line: node.spans[0].line,
    branchColumn: node.branchColumn ?? node.spans[0].column,
    startColumn: node.spans[0].column, endColumn: node.spans[0].endColumn - 1,
    parentId: node.parentId ? scoped(node.parentId) : undefined,
    childIds: node.childIds.map(scoped), foldRanges: []
  }));
  indexes.set(content, nodes);
  return nodes;
}
