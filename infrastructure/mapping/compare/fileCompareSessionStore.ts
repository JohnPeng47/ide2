import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ApplicationError } from '../../../application/core/errors';
import type { CompareSessionRepository } from '../../../application/mapping/compare/compareSessionService';
import { compareSessionSummary, type ComparePageSession } from '../../../domain/mapping/compare/comparePageSession';

export class FileCompareSessionStore implements CompareSessionRepository {
  private readonly directory: string;
  private queue = Promise.resolve();
  constructor(root: string) { this.directory = path.join(root, 'compare-sessions'); }
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('Invalid comparison session ID');
    return path.join(this.directory, `${id}.json`);
  }
  async read(id: string): Promise<ComparePageSession | null> {
    try { return JSON.parse(await readFile(this.file(id), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async list(projectId: string) {
    await mkdir(this.directory, { recursive: true });
    const sessions = await Promise.all((await readdir(this.directory)).filter(file => /^[a-f0-9-]{36}\.json$/i.test(file))
      .map(file => this.read(file.slice(0, -5))));
    return sessions.filter((session): session is ComparePageSession => !!session && session.projectId === projectId)
      .map(compareSessionSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  create(session: ComparePageSession): Promise<ComparePageSession> {
    const task = this.queue.then(async () => {
      const existing = await this.read(session.id);
      if (existing) {
        if (existing.requestHash !== session.requestHash) throw new ApplicationError('conflict', 'Request ID already used for another comparison.');
        return existing;
      }
      await mkdir(this.directory, { recursive: true });
      const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
      try { await writeFile(temporary, JSON.stringify(session), { mode: 0o600 }); await rename(temporary, this.file(session.id)); }
      finally { await rm(temporary, { force: true }); }
      return session;
    });
    this.queue = task.then(() => {}, () => {}); return task;
  }
}
