import { z } from 'zod';
import type { DiagramRevision } from '../../core/diagrams/diagramRevisionEditor';

const id = z.string().min(1).max(200);
export const editDiagramSchema = z.object({
  sessionId: id, nodeId: id, expectedVersion: z.number().int().nonnegative(),
  baseRevisionId: id, agentContextId: id.optional(), prompt: z.string().trim().min(1).max(20000), requestId: id
}).strict();
export const diagramEditRunSchema = z.object({ runId: id }).strict();
export type EditDiagramInput = z.infer<typeof editDiagramSchema>;
export interface DiagramRevisionApplication {
  requestId: string;
  expectedVersion: number;
  nodeId: string;
  baseRevisionId: string;
  revision: DiagramRevision;
}
export interface DiagramEditRun {
  runId: string;
  status: 'generating' | 'applying' | 'completed' | 'conflict' | 'failed' | 'cancelled' | 'awaiting-acknowledgement';
  nodeId: string;
  baseRevisionId: string;
  message?: string;
  error?: string;
  generated?: { diagramId: string; revisionId: string; ascii: string };
  result?: { diagramId: string; previousRevisionId: string; revisionId: string; documentVersion: number; unresolvedEdgeIds: string[] };
}
