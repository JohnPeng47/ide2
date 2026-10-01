import { DiagramPersistence } from '../../../domain/core/diagrams/diagramPersistence';
import type { ChangeSessionWriteScope, DiagramChangeSessionRepository } from '../../../application/mapping/changes/ports';
import { summarizeChangeSession, type ChangeSessionSummary, type ChangeSessionPreview, type DiagramChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
import { ChangeSessionRecords, type SessionWrite } from './changeSessionRecords';
import { changeSessionWorker } from './changeSessionWorker';

/** Metadata reads remain on the request thread; hydration/migration/writes can run in a worker. */
export class DiagramChangeSessionStore implements DiagramChangeSessionRepository {
  private readonly records: ChangeSessionRecords;
  private readonly tokens = new WeakMap<DiagramChangeSession, string>();
  constructor(private readonly root: string, diagrams?: DiagramPersistence, private readonly background = false) {
    this.records = new ChangeSessionRecords(root, diagrams);
  }
  listSummaries(projectId: string) { return this.records.listSummaries(projectId, id => this.readSummary(projectId, id)); }
  readSummary(projectId: string, id: string): Promise<ChangeSessionSummary> {
    return this.records.readSummary(projectId, id, this.background ? () => changeSessionWorker(this.root).request('readSummary', [projectId, id]) : undefined);
  }
  readPreview(projectId: string, id: string, documentId: string): Promise<ChangeSessionPreview> {
    return this.background ? changeSessionWorker(this.root).request('readPreview', [projectId, id, documentId]) : this.records.readPreview(projectId, id, documentId);
  }
  async read(projectId: string, id: string) {
    const result = this.background ? await changeSessionWorker(this.root).request<{ session: DiagramChangeSession; token: string }>('read', [projectId, id]) : await this.records.read(projectId, id);
    this.tokens.set(result.session, result.token); return result.session;
  }
  async write(session: DiagramChangeSession, scope?: ChangeSessionWriteScope) {
    const input: SessionWrite = { summary: summarizeChangeSession(session), expected: this.tokens.get(session),
      documents: scope ? session.documents.filter(doc => scope.documents.includes(doc.id)) : session.documents,
      receipts: scope ? Object.fromEntries(scope.receipts.map(key => [key, session.receipts[key]])) : session.receipts };
    const token = this.background ? await changeSessionWorker(this.root).request<string>('write', [input]) : await this.records.write(input);
    this.tokens.set(session, token);
  }
}
