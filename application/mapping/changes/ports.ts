import type { DiagramChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
export interface DiagramChangeSessionRepository {
  list(projectId: string): Promise<DiagramChangeSession[]>;
  read(projectId: string, id: string): Promise<DiagramChangeSession>;
  write(session: DiagramChangeSession): Promise<void>;
}
