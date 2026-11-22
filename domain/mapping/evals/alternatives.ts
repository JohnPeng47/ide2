import { z } from 'zod';
import { gridOutputId, gridPosition, outputEdge } from '../rollup/rollUp';

/** A new canvas generated from an AgentContext. */
export const alternativeOutputSchema = z.object({
  explanation: z.string().min(1).max(6000),
  diagrams: z.array(z.object({ id: gridOutputId, ascii: z.string().min(1), position: gridPosition }).strict()).min(1).max(20),
  edges: z.array(outputEdge).max(60)
}).strict();
export type AlternativeOutput = z.infer<typeof alternativeOutputSchema>;
