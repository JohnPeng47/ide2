import { z } from 'zod';
import type { DiagramContent } from './diagramContent';
import { diagramContentNodes } from './diagramContentNodes';

export const highlightColors = { yellow: '#facc15', blue: '#60a5fa', green: '#4ade80', pink: '#f472b6', purple: '#c084fc', orange: '#fb923c' } as const;
export const highlightColorSchema = z.union([z.enum(['yellow', 'blue', 'green', 'pink', 'purple', 'orange']), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
export const diagramHighlightSchema = z.object({
  id: z.string().min(1).max(200), contentNodeId: z.string().min(1).max(500).optional(), color: highlightColorSchema
}).strict();
export type DiagramHighlight = z.infer<typeof diagramHighlightSchema>;
export function highlightColor(color: string) { return highlightColors[color as keyof typeof highlightColors] ?? color; }
export function activeDiagramHighlights(content: DiagramContent, highlights: readonly DiagramHighlight[] = []) {
  const ids = new Set(diagramContentNodes(content).map(node => node.id));
  return highlights.filter(item => !item.contentNodeId || ids.has(item.contentNodeId));
}
export function validateDiagramHighlights(input: unknown) {
  const highlights = z.array(diagramHighlightSchema).max(2000).parse(input ?? []);
  if (new Set(highlights.map(item => item.id)).size !== highlights.length) throw Error('Duplicate highlight ID');
  return highlights;
}
/** Keep changed targets stale rather than silently highlighting unrelated replacement text. */
export function rebaseDiagramHighlights(highlights: readonly DiagramHighlight[], nodeIds: ReadonlyMap<string, string>): DiagramHighlight[] {
  return highlights.map(item => ({ ...item, ...(item.contentNodeId && nodeIds.has(item.contentNodeId) ? { contentNodeId: nodeIds.get(item.contentNodeId)! } : {}) }));
}
