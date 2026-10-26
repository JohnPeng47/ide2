import { canvasGenerationSchema } from './canvasGeneration';
import { z } from 'zod';
import type { StoredCanvasSnapshot } from './canvasHistory';

const id = z.string().min(1).max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
export const canvasViewSchema = z.object({
  id, name: z.string().trim().min(1).max(120), createdAt: z.string().datetime(),
  startCheckpointId: id, checkpointIds: z.array(id).min(1).max(100000),
  finalCheckpointId: id.optional(), savedAt: z.string().datetime().optional(),
  parentViewId: id.optional(), forkCheckpointId: id.optional(), alternativeGroupId: id.optional(),
  archivedAt: z.string().datetime().optional(), generation: canvasGenerationSchema.optional()
}).strict();
export type CanvasView = z.infer<typeof canvasViewSchema>;
export interface CanvasViews {
  saved: Record<string, CanvasView>; recording?: CanvasView;
  activeViewId?: string; workingCopies?: Record<string, string>;
}
export interface CanvasViewState extends CanvasViews { dirty?: boolean }
export interface CanvasViewSnapshot {
  checkpointId: string;
  document: import('./canvasHistory').ResolvedCanvasDocument;
  view: unknown;
  revisions: Record<string, import('./diagramRevision').DiagramRevision>;
}
export interface CanvasViewComparison { view: CanvasView; baseline: CanvasViewSnapshot; proposed: CanvasViewSnapshot }
export const canvasViewCommandSchema = z.object({
  operation: z.enum(['create', 'open', 'fork', 'save', 'alternatives', 'keep', 'discard', 'start', 'stop', 'list', 'read', 'apply', 'delete', 'cancel', 'promote-diffs']),
  name: z.string().trim().min(1).max(120).optional(), viewId: id.optional(),
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(10)
    .refine(names => new Set(names).size === names.length, 'Alternative names must be unique').optional()
}).strict();
export type CanvasViewCommand = z.infer<typeof canvasViewCommandSchema>;

export function validateCanvasViews(views: CanvasViews | undefined, snapshots: Record<string, StoredCanvasSnapshot>) {
  if (!views) return;
  const value = z.object({ saved: z.record(id, canvasViewSchema), recording: canvasViewSchema.optional(),
    activeViewId: id.optional(), workingCopies: z.record(id, id).optional() }).strict().parse(views);
  if (value.activeViewId && (!value.saved[value.activeViewId] || value.saved[value.activeViewId].archivedAt)) throw Error('Invalid active CanvasView');
  for (const [viewId, checkpointId] of Object.entries(value.workingCopies ?? {})) {
    if (!value.saved[viewId] || !Object.hasOwn(snapshots, checkpointId)) throw Error('Invalid CanvasView working copy');
  }
  for (const [key, view] of Object.entries(value.saved)) {
    if (key !== view.id || !view.savedAt || !view.finalCheckpointId) throw Error('Invalid saved CanvasView');
    if (view.forkCheckpointId && !Object.hasOwn(snapshots, view.forkCheckpointId)) throw Error('Missing CanvasView fork checkpoint');
    const visited = new Set([key]);
    let parentId = view.parentViewId;
    while (parentId) {
      if (visited.has(parentId) || !value.saved[parentId]) throw Error('Invalid CanvasView ancestry');
      visited.add(parentId); parentId = value.saved[parentId].parentViewId;
    }
  }
  if (value.recording && (value.recording.savedAt || value.recording.finalCheckpointId || value.saved[value.recording.id])) throw Error('Invalid CanvasView recording');
  for (const view of [...Object.values(value.saved), ...(value.recording ? [value.recording] : [])]) {
    if (view.startCheckpointId !== view.checkpointIds[0] || view.finalCheckpointId && view.finalCheckpointId !== view.checkpointIds.at(-1)
      || view.checkpointIds.some(id => !Object.hasOwn(snapshots, id))) throw Error('Missing CanvasView checkpoint');
  }
}

export const canvasViewInstructions = 'Manage saved views of the active canvas. create with name saves the current canvas immediately. save appends a saved checkpoint to the active view (optional viewId must match). open with viewId switches to that view and resumes its working copy; unsaved edits are retained when switching and the camera stays in place. fork with viewId and name creates and opens a child from the parent saved checkpoint. alternatives with viewId and names (1–10 unique names) creates a group of children from ONE pinned saved checkpoint without switching the canvas. For LLM generation use the gen-alternatives AgentChat tool instead: it manages isolated parallel children with prompts and status. The alternatives operation here only makes empty copies. Each child is independent. Do not reuse diagram revision IDs or anchors across opens. keep with viewId saves that candidate and archives its group siblings and their descendants; only do this when the user chooses a candidate. discard archives a view and descendants. list/read return saved views, parentViewId, forkCheckpointId, alternativeGroupId, archivedAt, activeViewId and working copies; exclude archivedAt entries when presenting available views. History is represented by parent/child ancestry; saved checkpoints remain immutable. Legacy recording operations: start with name, stop to save, cancel to keep edits but discard recording metadata. Legacy apply restores a saved endpoint, delete removes a leaf, promote-diffs adds diagram diff alternatives. Stop recording before other mutations. Mutations require Workspace access, current expectedVersion when using MCP, and a unique requestId. Retry identical arguments after uncertain outcomes.';
