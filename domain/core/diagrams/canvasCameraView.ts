import { z } from 'zod';

/** Stable targets; viewport dimensions determine the actual camera at render time. */
export const canvasCameraViewSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().trim().min(1).max(200),
  focus: z.discriminatedUnion('type', [
    z.object({ type: z.literal('DiagramFocused'), diagramId: z.string().min(1).max(200) }).strict(),
    z.object({ type: z.literal('CanvasFocused'), diagramIds: z.array(z.string().min(1).max(200)).min(1).max(100) }).strict()
  ])
}).strict();
export type CanvasCameraView = z.infer<typeof canvasCameraViewSchema>;
