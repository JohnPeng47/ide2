import { z } from 'zod';

export const canvasTypeSchema = z.enum(['standard', 'projection', 'generated']);
export type CanvasType = z.infer<typeof canvasTypeSchema>;

/** Read legacy canvases without retaining their old explorer parent hierarchy. */
export function canvasTypeOf(value: { type?: unknown; parentCanvasId?: unknown; canvas?: { projectionLayout?: unknown } }): CanvasType {
  return canvasTypeSchema.parse(value.type ?? (value.parentCanvasId || value.canvas?.projectionLayout ? 'projection' : 'standard'));
}
