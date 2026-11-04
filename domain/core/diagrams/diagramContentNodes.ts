import { deepFreeze } from '../immutability';
import type { DiagramContent, DiagramContentNode } from './diagramContent';
import { parseAsciiGraph } from './asciiGraph/parseAsciiGraph';
import { parseDiagram } from './interpreter';

// A derived index lets existing unstructured diagrams expose anchors without rewriting their content.
const indexes = new WeakMap<DiagramContent, readonly DiagramContentNode[]>();
export function diagramContentNodes(content: DiagramContent): readonly DiagramContentNode[] {
  if (content.structure.kind === 'tree') return Object.values(content.structure.nodes);
  const cached = indexes.get(content);
  if (cached) return cached;
  const nodes = content.structure.parserVersion === 'ascii-graph-1' ? graphNodes(content) : legacyNodes(content);
  deepFreeze(nodes);
  indexes.set(content, nodes);
  return nodes;
}

/** Content without a parser version keeps the interpreter-derived nodes its stored nodeRefs were keyed by. */
function legacyNodes(content: DiagramContent): DiagramContentNode[] {
  const parsed = parseDiagram(content.ascii, { dialect: 'mixed', repairs: 'none', continuation: 'separate' });
  const scoped = (id: string) => `${content.revisionId}:${content.asciiSha256}:${id}`;
  return parsed.nodes.filter(node => node.spans.length).map(node => ({
    id: scoped(node.id), label: node.label, line: node.spans[0].line,
    branchColumn: node.branchColumn ?? node.spans[0].column,
    startColumn: node.spans[0].column, endColumn: node.spans[0].endColumn - 1,
    parentId: node.parentId ? scoped(node.parentId) : undefined,
    childIds: node.childIds.map(scoped), foldRanges: []
  }));
}

function graphNodes(content: DiagramContent): DiagramContentNode[] {
  const graph = parseAsciiGraph(content.ascii);
  // IDs keep the earlier `node-<line>-<column>` form of a box's first span, so saved single-line references still resolve.
  const localId = new Map(graph.boxes.map(box => [box.id, `node-${box.lines[0].line}-${box.lines[0].col1}`]));
  const scoped = (id: string) => `${content.revisionId}:${content.asciiSha256}:${localId.get(id)}`;
  return graph.boxes.map((box): DiagramContentNode => ({
    id: scoped(box.id), label: box.text, line: box.lines[0].line,
    branchColumn: box.rect.col1, startColumn: box.lines[0].col1, endColumn: box.lines[0].col2,
    lines: box.lines.map(span => ({ line: span.line, startColumn: span.col1, endColumn: span.col2 })),
    parentId: box.parentId ? scoped(box.parentId) : undefined,
    childIds: box.childIds.map(scoped), foldRanges: []
  }));
}
