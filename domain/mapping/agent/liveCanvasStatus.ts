import { z } from 'zod';

const id = z.string().min(1).max(200);
export const liveSelectionSchema = z.object({
  documentId: id, canvasEpoch: id,
  sequence: z.number().int().nonnegative(), documentVersion: z.number().int().nonnegative(),
  text: z.string().max(2_000_000).nullable()
}).strict();
export type LiveSelection = z.infer<typeof liveSelectionSchema>;
export const liveCanvasMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('attach'), workspaceInstanceId: id, documentId: id }).strict(),
  // Browser publisher messages use the same socket endpoint, never an external client's binding.
  z.object({ type: z.literal('publish'), workspaceInstanceId: id }).strict(),
  liveSelectionSchema.extend({ type: z.literal('selection') }),
  z.object({ type: z.literal('remove'), documentId: id, canvasEpoch: id }).strict()
]);
export interface BoundSelection extends LiveSelection {
  connectionId: string; workspaceInstanceId: string; receivedAt: string;
}
export type LiveCanvasEvent = ({ type: 'attached' | 'selection.changed' } & BoundSelection)
  | { type: 'canvas.disconnected' | 'canvas.closed' | 'canvas.replaced'; connectionId: string; canvasEpoch: string }
  | { type: 'error'; code: string; error: string }
  | { type: 'publisher.ready' };
