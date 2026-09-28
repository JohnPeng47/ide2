import type { ChangeSessionSummary, ChangeSessionPreview, DiagramChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
export interface ChangeSessionWriteScope { documents: string[]; receipts: string[] }
export interface DiagramChangeSessionRepository {
  listSummaries(projectId: string): Promise<ChangeSessionSummary[]>;
  readSummary(projectId: string, id: string): Promise<ChangeSessionSummary>;
  readPreview(projectId: string, id: string, documentId: string): Promise<ChangeSessionPreview>;
  read(projectId: string, id: string): Promise<DiagramChangeSession>;
  write(session: DiagramChangeSession, scope?: ChangeSessionWriteScope): Promise<void>;
}
