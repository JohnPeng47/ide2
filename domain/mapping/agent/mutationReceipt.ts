import type { DiagramOperation } from '../workspace/mappingDocumentController';
import type { CanvasDisplayNode } from '../workspace/canvasDisplayNode';
import { highlightReferenceUrl } from '../agent-chat/highlightReference';
import { activeDiagramHighlights, sameHighlightTargets } from '../../core/diagrams/diagramHighlight';

export interface CanvasMutationReceipt {
  method: DiagramOperation['method'];
  nodeId?: string;
  edgeId?: string;
  highlightId?: string;
  color?: string;
  markdownUrl?: string;
  status: 'applied' | 'active' | 'stale' | 'removed';
}
export interface CanvasMutationResult { version: number; receipts: CanvasMutationReceipt[] }

/** Receipts describe the batch's final state; later operations may remove an earlier highlight. */
export function canvasMutationResult(documentId: string, operations: DiagramOperation[], result: { version: number; nodes: CanvasDisplayNode[]; highlightIds?: Record<string, string> }): CanvasMutationResult {
  return { version: result.version, receipts: operations.map(op => {
    const nodeId = 'nodeId' in op ? op.nodeId : op.method === 'diagram-create' ? `grid:${op.id}` : undefined;
    const receipt: CanvasMutationReceipt = { method: op.method, ...(nodeId ? { nodeId } : {}),
      ...('edge' in op ? { edgeId: op.edge.id } : 'edgeId' in op ? { edgeId: op.edgeId } : {}), status: 'applied' };
    if (op.method === 'highlight') {
      const node = result.nodes.find(node => node.id === nodeId);
      const diagram = node?.layout === 'grid' ? node.diagram : undefined;
      const highlight = diagram?.highlights?.find(item => item.id === (result.highlightIds?.[op.highlightId] ?? op.highlightId))
        ?? diagram?.highlights?.find(item => sameHighlightTargets(item, op));
      if (!diagram || !highlight) return { ...receipt, status: 'removed' };
      return { ...receipt, highlightId: highlight.id, color: highlight.color,
        status: activeDiagramHighlights(diagram.content, [highlight], diagram.revisionId).length ? 'active' : 'stale',
        markdownUrl: highlightReferenceUrl({ documentId, nodeId: op.nodeId, highlightId: highlight.id }) };
    }
    return receipt;
  }) };
}
