import { RevisionedDiagramService, type DiagramService } from '../../../domain/core/diagrams/diagramService';
import { DiagramRevisionStore } from '../../core/persistence/diagramRevisionStore';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DiagramChangeSessionRepository } from '../../../application/mapping/changes/ports';
import { changeId, validateChangeSession, type DiagramChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';

export class DiagramChangeSessionStore implements DiagramChangeSessionRepository {
  constructor(private readonly storeRoot: string, private readonly diagrams: DiagramService = new RevisionedDiagramService(new DiagramRevisionStore(storeRoot))) {}
  private directory(projectId: string) { return path.join(this.storeRoot, 'mapping-change-sessions', changeId.parse(projectId)); }
  async list(projectId: string) {
    const names = await readdir(this.directory(projectId)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    return Promise.all(names.filter(name => name.endsWith('.json')).map(name => this.read(projectId, name.slice(0, -5))));
  }
  async read(projectId: string, id: string) {
    const session = validateChangeSession(await this.diagrams.restore(JSON.parse(await readFile(path.join(this.directory(projectId), `${changeId.parse(id)}.json`), 'utf8'))));
    if (session.id !== id || session.projectId !== projectId) throw new Error('Change session identity mismatch');
    return session;
  }
  async write(session: DiagramChangeSession) {
    validateChangeSession(session);
    const stored = await this.diagrams.persist(session);
    const directory = this.directory(session.projectId);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${changeId.parse(session.id)}.json`), temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(stored), 'utf8'); await rename(temp, target); }
    finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
