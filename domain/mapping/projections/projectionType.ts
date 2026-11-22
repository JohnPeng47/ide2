import { z } from 'zod';

export const projectionTypeSchema = z.enum(['graph', 'layout', 'detail']);
export type ProjectionType = z.infer<typeof projectionTypeSchema>;
export function queryProjection(url: URL) {
  return projectionTypeSchema.optional().parse(url.searchParams.get('projectionType') ?? undefined);
}
