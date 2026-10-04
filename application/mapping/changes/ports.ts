import type { ChangeSessionSummary, ChangeSessionPreview, DiagramChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
export interface ChangeSessionWriteScope { documents: string[]; receipts: string[]; diffTree?: boolean }
export interface DiagramChangeSessionRepository {
  listSummaries(projectId: string): Promise<ChangeSessionSummary[]>;
  readSummary(projectId: string, id: string): Promise<ChangeSessionSummary>;
  readPreview(projectId: string, id: string, documentId: string): Promise<ChangeSessionPreview>;
  readDiffTree?(projectId: string, id: string): Promise<{ summary: ChangeSessionSummary; diffTree?: import('../../../domain/mapping/changes/diffTree').ChangeSessionDiffTree }>;
  read(projectId: string, id: string): Promise<DiagramChangeSession>;
  write(session: DiagramChangeSession, scope?: ChangeSessionWriteScope): Promise<void>;
}
