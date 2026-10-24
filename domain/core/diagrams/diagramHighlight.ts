import { z } from 'zod';
import type { DeepReadonly } from '../immutability';
import type { DiagramContent } from './diagramContent';
import { diagramContentNodes } from './diagramContentNodes';

export const highlightColors = { yellow: '#facc15', blue: '#60a5fa', green: '#4ade80', pink: '#f472b6', purple: '#c084fc', orange: '#fb923c' } as const;
export const highlightColorSchema = z.union([z.enum(['yellow', 'blue', 'green', 'pink', 'purple', 'orange']), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
export const highlightTargetsSchema = z.object({
  contentNodeId: z.string().min(1).max(500).optional(),
  contentNodeIds: z.array(z.string().min(1).max(500)).min(1).max(2000)
    .refine(ids => new Set(ids).size === ids.length, 'Duplicate highlight target').optional()
}).refine(target => !(target.contentNodeId && target.contentNodeIds), 'Use contentNodeId or contentNodeIds, not both');
export const diagramHighlightSchema = highlightTargetsSchema.safeExtend({
  id: z.string().min(1).max(200), color: highlightColorSchema,
  nodeRefs: z.array(z.string().min(1)).max(2000).optional(),
  revisionId: z.string().optional(),
  textRange: z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive(), startColumn: z.number().int().positive(), endColumn: z.number().int().positive() }).optional()
}).strict().refine(item => !item.textRange || (!!item.revisionId && !highlightNodeIds(item).length
  && item.textRange.endLine >= item.textRange.startLine
  && (item.textRange.startLine !== item.textRange.endLine || item.textRange.endColumn >= item.textRange.startColumn)),
  'Text highlights require a revision and an ordered text range, without node targets');
export function highlightNodeIds(target: { contentNodeId?: string; contentNodeIds?: readonly string[] }): readonly string[] {
  return target.contentNodeIds ?? (target.contentNodeId ? [target.contentNodeId] : []);
}
export function sameHighlightTargets(a: Parameters<typeof highlightNodeIds>[0], b: Parameters<typeof highlightNodeIds>[0]) {
  const first = highlightNodeIds(a), second = new Set(highlightNodeIds(b));
  return first.length === second.size && first.every(id => second.has(id));
}
export type DiagramHighlight = DeepReadonly<z.infer<typeof diagramHighlightSchema>>;
export function highlightColor(color: string) { return highlightColors[color as keyof typeof highlightColors] ?? color; }
export function activeDiagramHighlights(content: DiagramContent, highlights: readonly DiagramHighlight[] = [], revisionId = content.revisionId) {
  const ids = new Set(diagramContentNodes(content).map(node => node.id));
  return highlights.filter(item => (!item.textRange || item.revisionId === revisionId) && highlightNodeIds(item).every(id => ids.has(id)));
}
export function validateDiagramHighlights(input: unknown) {
  const highlights = z.array(diagramHighlightSchema).max(2000).parse(input ?? []);
  if (new Set(highlights.map(item => item.id)).size !== highlights.length) throw Error('Duplicate highlight ID');
  return highlights;
}
/** Keep changed targets stale rather than silently highlighting unrelated replacement text. */
export function rebaseDiagramHighlights(highlights: readonly DiagramHighlight[], nodeIds: ReadonlyMap<string, string>): DiagramHighlight[] {
  return highlights.map(item => ({ ...item,
    ...(item.contentNodeIds ? { contentNodeIds: item.contentNodeIds.map(id => nodeIds.get(id) ?? id) } : {}),
    ...(item.contentNodeId && nodeIds.has(item.contentNodeId) ? { contentNodeId: nodeIds.get(item.contentNodeId)! } : {}) }));
}
