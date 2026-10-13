import type { Diagram } from './diagram';
import { diagramContentNodes } from './diagramContentNodes';

export interface SubtreeRange { startLine: number; endLine: number }
export function diagramSubtreeRange(diagram: Diagram, contentNodeId: string): SubtreeRange {
  const nodes = diagramContentNodes(diagram.content), root = nodes.find(node => node.id === contentNodeId);
  if (!root) throw Error('STALE_SUBTREE: select a current node');
  const ids = new Set<string>();
  const visit = (id: string) => { if (ids.has(id)) return; ids.add(id); nodes.find(node => node.id === id)?.childIds.forEach(visit); };
  visit(root.id);
  const descendants = nodes.filter(node => ids.has(node.id));
  const last = Math.max(...descendants.map(node => node.line), ...root.foldRanges.map(range => range.endLine));
  if (nodes.some(node => node.line >= root.line && node.line <= last && !ids.has(node.id)))
    throw Error('This selection is not a contiguous subtree. Choose a tree branch.');
  return { startLine: root.line, endLine: last };
}

/** A candidate contains full context, but only the selected range may differ. */
export function subtreeReplacement(base: Diagram, ascii: string, range: SubtreeRange): string {
  const before = base.content.ascii.split('\n'), after = ascii.split('\n');
  const prefix = before.slice(0, range.startLine - 1), suffix = before.slice(range.endLine);
  if (after.length < prefix.length + suffix.length || prefix.some((line, i) => line !== after[i])
    || suffix.some((line, i) => line !== after[after.length - suffix.length + i]))
    throw Error('SUBTREE_SCOPE: preserve every line outside the selected subtree exactly');
  return after.slice(prefix.length, after.length - suffix.length).join('\n');
}
