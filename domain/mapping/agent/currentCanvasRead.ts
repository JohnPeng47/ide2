import type { LiveDocumentSnapshot } from './contracts';
import { canvasDisplayNodes, type CanvasDisplayNode } from '../workspace/canvasDisplayNode';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { activeDiagramHighlights } from '../../core/diagrams/diagramHighlight';
import { activeDiagramJumps } from '../../core/diagrams/diagramJump';

type State = Pick<LiveDocumentSnapshot, 'document' | 'canvas' | 'version' | 'cell' | 'endpointBounds'>;
/** Small reads never construct geometry, floating selections, rendered arrows, or history. */
function textNodes(state: State, selected?: Set<string>): CanvasDisplayNode[] {
  const nodes: CanvasDisplayNode[] = [];
  const visit = (box: State['document']['scene']['root']) => {
    if (box.kind === 'container') { box.children.forEach(visit); return; }
    const id = `grid:${box.id}`;
    if (selected && !selected.has(id)) return;
    const diagram = state.document.scene.contents[box.contentId], content = diagram.content, view = state.canvas.diagramViews?.[id];
    nodes.push({ id, boxId: box.id, version: state.version, layout: 'grid', kind: 'diagram', childIds: [], expansion: box.collapsed ? 'collapsed' : 'expanded',
      // Geometry is deliberately absent from the public small projection below.
      geometry: { units: 'cells', bounds: { column: 0, row: 0, columns: 0, rows: 0 } }, content, diagram,
      collapsible: { self: true, subtrees: diagramContentNodes(content).filter(n => n.childIds.length).map(n => ({ contentNodeId: n.id,
        label: n.label, line: n.line, branchColumn: n.branchColumn,
        expansion: view?.contentRevisionId === content.revisionId && view.collapsedContentNodeIds.includes(n.id) ? 'collapsed' : 'expanded' })) } });
  };
  visit(state.document.scene.root);
  return nodes;
}
/** Select on the producer side; source evidence is complete for the selected diagrams. */
export function currentCanvasRead(state: State, options: { level: 'small' | 'full'; nodeIds?: string[] }) {
  const selected = options.nodeIds && new Set(options.nodeIds);
  const raw = options.level === 'small' ? textNodes(state, selected) : canvasDisplayNodes(state.document, state.canvas, state.version, state.cell, state.endpointBounds);
  const nodes = raw.filter(node => !selected || selected.has(node.id)).map(node => {
    if (node.layout !== 'grid') return node;
    const { content, contentNodes: _nodes, diagram, geometry, ...rest } = node;
    const { asciiSha256: _hash, ...text } = content ?? {};
    const { content: _content, sourceContext: _source, ...metadata } = diagram ?? {};
    const { contentHash: _sourceHash, ...sourceContext } = diagram?.sourceContext ?? {};
    const activeHighlights = new Set(diagram && activeDiagramHighlights(diagram.content, diagram.highlights).map(h => h.id));
    const activeJumps = new Set(diagram && activeDiagramJumps(diagram.content, diagram.jumps).map(j => j.id));
    return { ...rest, ...(options.level === 'full' ? { geometry } : {}),
      ...(content ? { content: { ...text, structure: { ...content.structure, nodes: Object.fromEntries(diagramContentNodes(content).map(n => [n.id, {
        ...n, sourceRanges: diagram?.sourceContext.mappings.filter(m => m.line === n.line && m.startColumn <= n.endColumn && m.endColumn >= n.startColumn)
          .flatMap(m => { const range = diagram.sourceContext.evidence[m.entityId]?.sourceRanges[m.sourceRangeIndex];
            return range ? [{ path: range.path, startLine: range.startLine, endLine: range.endLine }] : []; }) ?? []
      }])) } } } : {}),
      ...(diagram ? { diagram: { ...metadata, sourceContext,
        highlights: diagram.highlights?.map(h => ({ ...h, status: activeHighlights.has(h.id) ? 'active' : 'stale' })),
        jumps: diagram.jumps?.map(j => { const { contentHash: _hash, ...source } = j.source;
          return { ...j, source, status: activeJumps.has(j.id) ? 'active' : 'stale' }; }) } } : {}) };
  });
  return { level: options.level, version: state.version, nodes,
    ...(options.level === 'full' ? { edges: state.document.edges, view: state.canvas } : {}) };
}
