import { z } from 'zod';
import type { StoredCanvasSnapshot } from './canvasHistory';

const id = z.string().min(1).max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
export const canvasViewSchema = z.object({
  id, name: z.string().trim().min(1).max(120), createdAt: z.string().datetime(),
  startCheckpointId: id, checkpointIds: z.array(id).min(1).max(100000),
  finalCheckpointId: id.optional(), savedAt: z.string().datetime().optional()
}).strict();
export type CanvasView = z.infer<typeof canvasViewSchema>;
export interface CanvasViews { saved: Record<string, CanvasView>; recording?: CanvasView }
export interface CanvasViewSnapshot {
  checkpointId: string;
  document: import('./canvasHistory').ResolvedCanvasDocument;
  view: unknown;
  revisions: Record<string, import('./diagramRevision').DiagramRevision>;
}
export interface CanvasViewComparison { view: CanvasView; baseline: CanvasViewSnapshot; proposed: CanvasViewSnapshot }
export const canvasViewCommandSchema = z.object({
  operation: z.enum(['start', 'stop', 'list', 'read', 'apply', 'delete', 'cancel']),
  name: z.string().trim().min(1).max(120).optional(), viewId: id.optional()
}).strict();
export type CanvasViewCommand = z.infer<typeof canvasViewCommandSchema>;

export function validateCanvasViews(views: CanvasViews | undefined, snapshots: Record<string, StoredCanvasSnapshot>) {
  if (!views) return;
  const value = z.object({ saved: z.record(id, canvasViewSchema), recording: canvasViewSchema.optional() }).strict().parse(views);
  for (const [key, view] of Object.entries(value.saved)) {
    if (key !== view.id || !view.savedAt || !view.finalCheckpointId) throw Error('Invalid saved CanvasView');
  }
  if (value.recording && (value.recording.savedAt || value.recording.finalCheckpointId || value.saved[value.recording.id])) throw Error('Invalid CanvasView recording');
  for (const view of [...Object.values(value.saved), ...(value.recording ? [value.recording] : [])]) {
    if (view.startCheckpointId !== view.checkpointIds[0] || view.finalCheckpointId && view.finalCheckpointId !== view.checkpointIds.at(-1)
      || view.checkpointIds.some(id => !Object.hasOwn(snapshots, id))) throw Error('Missing CanvasView checkpoint');
  }
}
