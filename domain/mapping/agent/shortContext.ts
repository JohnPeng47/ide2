import { asciiSha256 } from '../../core/diagrams/asciiSha256';
import type { DiagramAnchor } from '../../core/diagrams/diagramConnection';
import { activeDiagramJumps } from '../../core/diagrams/diagramJump';
import type { ApiDisplayNode } from './apiRepresentation';
import type { ApiLiveCanvasContext } from './liveCanvasStatus';

/** Read-only overview. Detailed API reads remain authoritative for editing and evidence. */
export function shortCanvasContext(context: ApiLiveCanvasContext) {
  const nodes = new Map(context.nodes.map(node => [node.id, node]));
  const grids = context.nodes.filter(node => node.layout === 'grid');
  const floating = context.nodes.filter(node => node.layout === 'floating');
  const renderStatus = new Map(floating.flatMap(node => node.value.kind === 'arrow'
    ? [[node.value.edgeId, node.value.status] as const] : []));
  const summary = (node: ApiDisplayNode) => ({ id: node.id, geometry: node.geometry,
    expansion: node.expansion, childIds: node.childIds });
  const endpoint = <T extends DiagramAnchor>(anchor: T) => {
    const node = nodes.get(anchor.displayNodeId);
    if (!node || node.layout !== 'grid') return { ...anchor, status: 'missing' as const };
    if (anchor.kind === 'box') return { ...anchor, status: 'resolved' as const };
    const content = node.content;
    const location = content?.structure.nodes[anchor.contentNodeId];
    if (!content || content.revisionId !== anchor.revisionId || !location)
      return { ...anchor, status: 'stale' as const };
    return { ...anchor, status: 'resolved' as const, line: location.line,
      startColumn: location.startColumn, endColumn: location.endColumn };
  };
  return {
    apiFormatVersion: context.apiFormatVersion, shortFormatVersion: 1 as const, view: 'short' as const,
    version: context.version, name: context.name,
    diagrams: grids.filter(node => node.kind === 'diagram').map(node => {
      const content = node.content;
      if (!content) throw new Error(`Diagram ${node.id} has no content`);
      const source = node.diagram?.sourceContext;
      const activeJumps = new Set(activeDiagramJumps(content, node.diagram?.jumps).map(jump => jump.id));
      return {
        ...summary(node), revisionId: content.revisionId, asciiSha256: content.asciiSha256,
        ascii: content.ascii, structureKind: content.structure.kind,
        collapsedAnchorIds: node.collapsible.subtrees.filter(item => item.expansion === 'collapsed').map(item => item.contentNodeId),
        sourceReferences: {
          binding: source?.binding, mappings: source?.mappings ?? [],
          entities: Object.values(source?.evidence ?? {}).map(entity => ({
            id: entity.id, sourceId: entity.sourceId, handle: entity.handle, label: entity.label,
            sourceRanges: entity.sourceRanges.map(range => ({ id: range.id, path: range.path,
              startLine: range.startLine, endLine: range.endLine, symbol: range.symbol }))
          }))
        },
        ...(node.diagram?.jumps?.length ? { jumps: node.diagram.jumps.map(jump => ({ ...jump,
          sourceStatus: activeJumps.has(jump.id) ? 'current' as const : 'stale' as const })) } : {})
      };
    }),
    edges: context.edges.map(edge => ({ ...edge, source: endpoint(edge.source), target: endpoint(edge.target),
      renderStatus: renderStatus.get(edge.id) })),
    groups: grids.filter(node => node.kind === 'group').map(summary),
    selections: floating.flatMap(node => {
      if (node.value.kind !== 'selection') return [];
      const value = node.value, sourceDisplayNodeId = `grid:${value.sourceBoxId}`;
      const source = nodes.get(sourceDisplayNodeId);
      return [{ ...summary(node), sourceDisplayNodeId, sourceContentId: value.sourceContentId,
        sourceRevisionId: value.sourceRevisionId, sourceAsciiSha256: asciiSha256(value.sourceAscii),
        matchesCurrentSource: source?.layout === 'grid' && source.diagram?.id === value.sourceContentId
          && source.content?.ascii === value.sourceAscii,
        rect: value.rect, selectedIds: value.selectedIds, displayMode: value.displayMode,
        activeChildId: value.activeChildId }];
    }),
    // Preserve discoverability and parent/child relationships for non-diagram panes.
    otherNodes: floating.filter(node => node.kind !== 'selection' && node.kind !== 'arrow').map(node => ({
      ...summary(node), kind: node.kind, ...('title' in node.value ? { title: node.value.title } : {})
    })),
    detailsDeferred: ['fullAnchorIndex', 'sourceEvidenceText', 'selectionSourceSnapshots', 'renderedArrows', 'otherNodeContent']
  };
}

export type ShortCanvasContext = ReturnType<typeof shortCanvasContext>;
