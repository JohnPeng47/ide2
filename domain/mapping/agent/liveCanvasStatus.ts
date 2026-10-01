import { z } from 'zod';

const id = z.string().min(1).max(200);
const version = z.number().int().nonnegative();
const rect = z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  startColumn: z.number().int().positive(), endColumn: z.number().int().positive() }).strict();
export const liveRegionSchema = z.object({
  id, sourceBoxId: id, sourceContentId: id, rect,
  text: z.string().max(2_000_000), stale: z.boolean()
}).strict();
export type LiveRegion = z.infer<typeof liveRegionSchema>;
const diagramIds = z.array(id.refine(value => value.startsWith('grid:'), 'Expected a nodes.list() grid ID')).max(1000).optional();
const metadata = { documentId: id, canvasEpoch: id, sequence: version, documentVersion: version };
export const liveSelectionSchema = z.object({ ...metadata, regions: z.array(liveRegionSchema).max(1000), diagramIds }).strict();
export const liveSelectionDeltaSchema = z.object({ ...metadata, baseSequence: version, diagramIds,
  upserted: z.array(liveRegionSchema).max(1000), removed: z.array(id).max(1000) }).strict();
export type LiveSelection = z.infer<typeof liveSelectionSchema>;
export type LiveSelectionDelta = z.infer<typeof liveSelectionDeltaSchema>;
export const liveCanvasMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('attach'), protocolVersion: z.literal(2), workspaceInstanceId: id, documentId: id, includeContext: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('context.get'), requestId: id }).strict(),
  z.object({ type: z.literal('publish'), protocolVersion: z.literal(2), workspaceInstanceId: id }).strict(),
  liveSelectionSchema.extend({ type: z.literal('selection.snapshot') }),
  liveSelectionDeltaSchema.extend({ type: z.literal('selection.delta') }),
  z.object({ type: z.literal('remove'), documentId: id, canvasEpoch: id }).strict()
]);
export interface BoundSelection extends LiveSelection {
  protocolVersion: 2; connectionId: string; workspaceInstanceId: string; receivedAt: string;
}
export interface LiveCanvasContext {
  version: number; name?: string;
  nodes: import('../workspace/canvasDisplayNode').CanvasDisplayNode[];
  edges: import('../../core/diagrams/diagramConnection').DiagramConnection[];
}
export type LiveCanvasEvent = ({ type: 'attached'; context?: LiveCanvasContext } & BoundSelection)
  | { type: 'context.snapshot'; requestId: string; connectionId: string; workspaceInstanceId: string; documentId: string; canvasEpoch: string; context: LiveCanvasContext }
  | ({ type: 'selection.delta' } & LiveSelectionDelta & Pick<BoundSelection, 'connectionId' | 'workspaceInstanceId' | 'receivedAt'>)
  | { type: 'canvas.disconnected' | 'canvas.closed' | 'canvas.replaced'; connectionId: string; canvasEpoch: string }
  | { type: 'error'; code: string; error: string; requestId?: string }
  | { type: 'publisher.ready'; protocolVersion: 2 }
  | { type: 'agents.changed'; count: number };

export function sameRegion(a: LiveRegion, b: LiveRegion): boolean {
  return a === b || a.id === b.id && a.sourceBoxId === b.sourceBoxId && a.sourceContentId === b.sourceContentId
    && a.stale === b.stale && a.text === b.text && a.rect.startLine === b.rect.startLine && a.rect.endLine === b.rect.endLine
    && a.rect.startColumn === b.rect.startColumn && a.rect.endColumn === b.rect.endColumn;
}
export function sameDiagramSelection(a: readonly string[] = [], b: readonly string[] = []): boolean {
  const ids = new Set(a);
  return ids.size === b.length && b.every(id => ids.has(id));
}
/** Compare against the last transmitted snapshot, never against a dropped pending delta. */
export function selectionDelta(previous: LiveSelection, next: LiveSelection): LiveSelectionDelta {
  const before = new Map(previous.regions.map(region => [region.id, region]));
  const after = new Set(next.regions.map(region => region.id));
  return { documentId: next.documentId, canvasEpoch: next.canvasEpoch, sequence: next.sequence,
    documentVersion: next.documentVersion, baseSequence: previous.sequence,
    ...(!sameDiagramSelection(previous.diagramIds, next.diagramIds) ? { diagramIds: next.diagramIds ?? [] } : {}),
    upserted: next.regions.filter(region => !before.has(region.id) || !sameRegion(before.get(region.id)!, region)),
    removed: previous.regions.filter(region => !after.has(region.id)).map(region => region.id) };
}
