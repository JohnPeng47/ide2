import { z } from 'zod';
import type { ProjectRepresentationRecord } from '../representations/projectCatalog';
export const checkpointPublicationSchema = z.object({
  documentId: z.string().min(1).max(200), checkpointId: z.string().min(1).max(200),
  expectedVersion: z.number().int().nonnegative(), requestId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120), representationId: z.string().min(1).max(200).optional(),
  expectedRevisionId: z.string().max(200).optional(), repositoryId: z.string().max(200).optional()
}).strict();
export type CheckpointPublication = z.infer<typeof checkpointPublicationSchema>;
export interface CheckpointReceipt { representation: ProjectRepresentationRecord; revisionId: string; savedVersion: number; checkpointId: string }

export interface CapturedCheckpoint {
  header: import('./canvasHistory').HistoryChanges['header'];
  head: import('./canvasHistory').StoredCanvasSnapshot;
  revisions: Record<string, import('./diagramRevisionEditor').DiagramRevision>;
  metadata: { repositoryId?: string };
  stored: unknown;
}
