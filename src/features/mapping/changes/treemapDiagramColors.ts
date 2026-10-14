import type { CSSProperties } from 'react';
import type { ChangeTreemapNode } from '../../../../domain/mapping/changes/changeTreemap';

// Position is a preorder rank in the full tree, never a zoomed or pixel position.
const palette = ['#a78bfa', '#67d8ef', '#f7b267', '#f28bbd', '#91c788', '#879cf5', '#e5cd76', '#cf9deb', '#75cdb2', '#e99882', '#a3bfd9', '#c0ce80'];
export function diagramColorAt(position: number): string {
  return palette[position] ?? `hsl(${(position * 137.508 % 360).toFixed(3)} 65% 72%)`;
}
export interface TreemapDiagramColor {
  documentId: string; displayNodeId: string; contentNodeId?: string; position: number; color: string;
}
export interface TreemapCanvasColors { sessionId: string; diagrams: readonly TreemapDiagramColor[] }
export function treemapDiagramColors(root?: ChangeTreemapNode) {
  const diagrams: TreemapDiagramColor[] = [], nodes = new Map<string, TreemapDiagramColor>();
  const visit = (node: ChangeTreemapNode, parent?: TreemapDiagramColor) => {
    let identity = parent;
    if (node.target?.displayNodeId) {
      // A direct-allocation tile represents its parent's own code, not another subtree.
      if (node.kind !== 'direct' || !parent) {
        const position = diagrams.length;
        identity = { documentId: node.target.representationId, displayNodeId: node.target.displayNodeId,
          contentNodeId: node.target.contentNodeId, position, color: diagramColorAt(position) };
        diagrams.push(identity);
      }
      nodes.set(node.id, identity!);
    }
    node.children.forEach(child => visit(child, identity));
  };
  root?.children.forEach(node => visit(node));
  return { diagrams, nodes };
}
export const diagramColorStyle = (color?: string): CSSProperties => color ? { '--treemap-diagram-color': color } as CSSProperties : {};
