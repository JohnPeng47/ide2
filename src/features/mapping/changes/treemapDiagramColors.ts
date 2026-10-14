import type { CSSProperties } from 'react';
import type { ChangeTreemapNode } from '../../../../domain/mapping/changes/changeTreemap';

// Position is a preorder rank in the full tree, never a zoomed or pixel position.
export function diagramColorAt(position: number): string {
  // Rotate through blue → purple → red → orange, skipping hues 45–205°.
  return position < 12 ? `var(--diagram-color-${position + 1})`
    : `hsl(${((205 + position * 137.508 % 200) % 360).toFixed(3)} var(--diagram-color-saturation) var(--diagram-color-lightness))`;
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
