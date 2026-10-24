import { z } from 'zod';
import { diagramMarkerRulesSchema } from '../diagrams/diagramMarkers';
import { diagramHighlightSchema, highlightColorSchema } from '../diagrams/diagramHighlight';
import type { Diagram } from '../diagrams/diagram';
import type { DiagramHighlight } from '../diagrams/diagramHighlight';
import type { DiagramMarkerRule } from '../diagrams/diagramMarkers';

export interface MarkerStyle { color?: string; underline?: boolean }
/** Persisted presentation settings. Changing these never changes a content revision. */
export interface DiagramPresentationSettings {
  highlights?: readonly DiagramHighlight[];
  markerRules?: readonly DiagramMarkerRule[];
  markerStyles?: Readonly<Record<string, MarkerStyle>>;
}
export type DiagramPresentations = Record<string, DiagramPresentationSettings>;

/** Legacy revision annotations are a read fallback until a presentation is edited. */
export function presentationHighlights(diagram: Diagram, settings?: DiagramPresentationSettings,
  nodeRefs: Readonly<Record<string, string>> = {}): readonly DiagramHighlight[] {
  const items = settings?.highlights ?? diagram.highlights ?? [];
  if (!items.some(item => item.nodeRefs?.length)) return items;
  const parsed = new Map(Object.entries(nodeRefs).map(([id, ref]) => [ref, id]));
  return items.map(item => {
    if (!item.nodeRefs?.length) return item;
    const ids = item.nodeRefs.map(ref => parsed.get(ref) ?? `stale:${ref}`);
    return item.contentNodeIds ? { ...item, contentNodeIds: ids } : { ...item, contentNodeId: ids[0] };
  });
}

export const diagramPresentationSettingsSchema = z.object({
  highlights: z.array(diagramHighlightSchema).max(2000)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate highlight ID').optional(),
  markerRules: diagramMarkerRulesSchema.optional(),
  markerStyles: z.record(z.string().min(1).max(100), z.object({ color: highlightColorSchema.optional(), underline: z.boolean().optional() }).strict()).optional()
}).strict();
