import type { Node, NodePresentation } from '../nodes/node';
import type { Diagram } from './diagram';
import type { DiagramHighlight } from './diagramHighlight';

export type DiagramNode = Node<'diagram', { readonly diagramId: string; readonly revisionId: string }>;

export interface DiagramPresentationState {
  readonly display: 'regular' | 'diff';
  readonly collapsed: boolean;
  readonly collapsedNodeRefs: readonly string[];
  readonly baseRevisionId?: string;
  readonly highlights: readonly DiagramHighlight[];
}
export type DiagramPresentation = NodePresentation<DiagramPresentationState>;

/** Adapt existing placements without duplicating immutable content in canvas state. */
export function diagramNode(id: string, diagram: Diagram): DiagramNode {
  return { id, kind: 'diagram', content: { diagramId: diagram.diagramId, revisionId: diagram.revisionId } };
}
