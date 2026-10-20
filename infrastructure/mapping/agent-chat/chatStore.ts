import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatStore } from '../../../application/mapping/agent-chat/ports';
import type { ChatSession } from '../../../domain/mapping/agent-chat/agentChat';

export class FileChatStore implements ChatStore {
  private directory: string;
  private queue = Promise.resolve();
  constructor(root: string) { this.directory = path.join(root, 'agent-chat'); }
  async list(): Promise<ChatSession[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(name => /^[a-f0-9-]+\.json$/.test(name));
    return Promise.all(files.map(async name => JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as ChatSession));
  }
  save(session: ChatSession) {
    const content = JSON.stringify(session);
    const file = path.join(this.directory, `${session.id}.json`);
    const save = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await writeFile(`${file}.tmp`, content, { mode: 0o600 }); await rename(`${file}.tmp`, file);
    });
    this.queue = save.catch(() => {});
    return save;
  }
}
