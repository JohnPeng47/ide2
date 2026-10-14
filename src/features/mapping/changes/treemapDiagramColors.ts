import type { CSSProperties } from 'react';
import type { TreemapColorScale } from '../../../shared/theme/colorOpacity';
import type { ChangeTreemapNode } from '../../../../domain/mapping/changes/changeTreemap';

/** Reference range comes from the complete map, never the current zoom. */
export function treemapMaxLoc(root?: ChangeTreemapNode): number {
  return Math.max(0, ...root?.children.filter(node => node.kind !== 'unmapped').map(node => node.value) ?? []);
}
export function treemapLocColor(loc: number, maxLoc: number): string {
  const amount = maxLoc > 0 ? Math.max(0, Math.min(1, loc / maxLoc)) : 0;
  return `color-mix(in srgb, var(--treemap-loc-low), var(--treemap-loc-high) ${(amount * 100).toFixed(4)}%)`;
}
/** Rank all positive values in the complete hierarchy, including aggregate headings.
 * Equal values share a shade. Zooming and traversal order never change the scale. */
export function treemapLocScale(root?: ChangeTreemapNode, mode: TreemapColorScale = 'ranked') {
  const values = new Set<number>();
  const visit = (node: ChangeTreemapNode) => {
    if (node.kind === 'unmapped') return;
    if (node.value > 0) values.add(node.value);
    node.children.forEach(visit);
  };
  root?.children.forEach(visit);
  const sorted = [...values].sort((a, b) => a - b);
  const ranks = new Map(sorted.map((value, index) => [value, sorted.length === 1 ? 1 : index / (sorted.length - 1)]));
  const max = sorted.at(-1) ?? 0;
  return {
    min: mode === 'ranked' ? sorted[0] ?? 0 : 0, max,
    color: (loc: number) => mode === 'continuous' ? treemapLocColor(loc, max) : treemapLocColor(ranks.get(loc) ?? 0, 1),
  };
}
export interface TreemapDiagramColor {
  nodeId?: string; onSelect?: () => void; documentId: string; displayNodeId: string; contentNodeId?: string; position: number; color: string; direct?: boolean; hovered?: boolean;
}
export interface TreemapCanvasColors { sessionId: string; diagrams: readonly TreemapDiagramColor[] }
export function treemapDiagramColors(root?: ChangeTreemapNode, mode: TreemapColorScale = 'ranked') {
  const scale = treemapLocScale(root, mode);
  const diagrams: TreemapDiagramColor[] = [], nodes = new Map<string, TreemapDiagramColor>();
  const visit = (node: ChangeTreemapNode, parent?: TreemapDiagramColor) => {
    let identity = parent;
    if (node.target?.displayNodeId) {
      // A direct-allocation tile represents its parent's own code, not another subtree.
      if (node.kind !== 'direct' || !parent) {
        const position = diagrams.length;
        identity = { nodeId: node.id, documentId: node.target.representationId, displayNodeId: node.target.displayNodeId,
          contentNodeId: node.target.contentNodeId, position, color: scale.color(node.value) };
        diagrams.push(identity);
      }
      // A direct tile has its own LOC, but the same canvas destination as its parent.
      if (node.kind === 'direct' && parent) identity = { ...parent, nodeId: node.id, direct: true, color: scale.color(node.value) };
      nodes.set(node.id, identity!);
    }
    node.children.forEach(child => visit(child, identity));
  };
  root?.children.forEach(node => visit(node));
  return { diagrams, nodes };
}
export const diagramColorStyle = (color?: string): CSSProperties => color ? { '--treemap-diagram-color': color } as CSSProperties : {};
