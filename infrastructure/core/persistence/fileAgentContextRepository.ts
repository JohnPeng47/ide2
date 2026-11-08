import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, open, link, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { savedAgentContextIdSchema, savedAgentContextSchema, summarizeAgentContext, updateAgentContextSchema, addAgentContextCommentSchema, type SavedAgentContext } from '../../../domain/core/agents/savedAgentContext';
import type { AgentContextRepository } from '../../../application/core/ports/agentContextRepository';

/** Globally addressable within this application store; no canvas or chat binding. */
export class FileAgentContextRepository implements AgentContextRepository {
  private readonly directory: string;
  constructor(root: string) { this.directory = path.join(root, 'agent-contexts'); }
  private file(id: string) { return path.join(this.directory, `${savedAgentContextIdSchema.parse(id)}.json`); }
  async read(id: string): Promise<SavedAgentContext | null> {
    try {
      const record = savedAgentContextSchema.parse(JSON.parse(await readFile(this.file(id), 'utf8')));
      if (record.agentContextId !== id) throw Error('AGENT_CONTEXT_ID_MISMATCH');
      AgentContext.fromSnapshot(record.snapshot);
      return record;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async create(record: SavedAgentContext) {
    const file = this.file(record.agentContextId);
    await mkdir(this.directory, { recursive: true });
    const temp = path.join(this.directory, `.${randomUUID()}.tmp`);
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
      // An atomic, exclusive publish also protects identical IDs across processes.
      try { await link(temp, file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      const saved = (await this.read(record.agentContextId))!;
      if (saved.requestHash !== record.requestHash) throw Error('REQUEST_ID_CONFLICT: this UUID identifies a different saved context');
      return saved;
    } finally { await rm(temp, { force: true }); }
  }
  async updateGroup(id: string, group: string | null) {
    const input = updateAgentContextSchema.parse({ agentContextId: id, group });
    return this.mutateMetadata(id, record => {
      if (input.group === null) delete record.group;
      else record.group = input.group;
    });
  }
  async addComment(raw: Parameters<AgentContextRepository['addComment']>[0]) {
    const input = addAgentContextCommentSchema.parse(raw);
    return this.mutateMetadata(input.agentContextId, record => {
      const previous = record.comments?.find(comment => comment.commentId === input.requestId);
      if (previous) {
        if (previous.text !== input.text || previous.contentHash !== input.expectedContentHash)
          throw Error('REQUEST_ID_CONFLICT: this UUID identifies a different comment');
        return;
      }
      if (record.snapshot.contentHash !== input.expectedContentHash) throw Error('AGENT_CONTEXT_CHANGED: reread the context before commenting');
      (record.comments ??= []).push({ commentId: input.requestId, text: input.text,
        contentHash: input.expectedContentHash, createdAt: new Date().toISOString() });
    });
  }
  private async mutateMetadata(id: string, mutate: (record: SavedAgentContext) => void) {
    await mkdir(this.directory, { recursive: true });
    const lock = `${this.file(id)}.lock`, deadline = Date.now() + 5000;
    // Coordinate metadata writers across repository instances and backend processes.
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw Error('AGENT_CONTEXT_BUSY: metadata is locked; retry after the writer finishes');
        await delay(10);
      }
    }
    const temp = path.join(this.directory, `.${randomUUID()}.tmp`);
    try {
      const record = await this.read(id);
      if (!record) throw Error('AGENT_CONTEXT_NOT_FOUND: saved context is unavailable');
      mutate(record);
      savedAgentContextSchema.parse(record);
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, this.file(id));
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return record;
    } finally {
      try { await rm(temp, { force: true }); } finally { await rm(lock, { recursive: true, force: true }); }
    }
  }
  async summaries() {
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const summaries: ReturnType<typeof summarizeAgentContext>[] = [];
    for (const file of files) if (/^saved-agent-context-[a-f0-9-]{36}\.json$/.test(file)) {
      const record = await this.read(file.slice(0, -5)); if (record) summaries.push(summarizeAgentContext(record));
    }
    return summaries;
  }
}
