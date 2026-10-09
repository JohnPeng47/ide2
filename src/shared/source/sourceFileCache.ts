import type { CodeRepoFile, CodeRepoReference } from '../../../domain/core/source/codeRepoService';

export interface SourceFileRequest { repo: CodeRepoReference; path: string; version?: string }
const identity = ({ repo, path }: SourceFileRequest) => JSON.stringify([repo.projectId, repo.sourceId, path]);

/** One bounded queue for background and on-demand reads; failed reads remain retryable. */
export class SourceFileCache {
  private entries = new Map<string, { version?: string; value: Promise<CodeRepoFile> }>();
  private queue: { key: string; run: () => Promise<void> }[] = [];
  private active = 0;
  constructor(private load: (file: SourceFileRequest) => Promise<CodeRepoFile>, private concurrency = 4) {}
  read(file: SourceFileRequest, reload = false, background = false): Promise<CodeRepoFile> {
    const key = identity(file), previous = this.entries.get(key);
    if (!reload && previous && (!file.version || !previous.version || file.version === previous.version)) {
      previous.version ??= file.version;
      if (!background) {
        const index = this.queue.findIndex(job => job.key === key);
        if (index > 0) this.queue.unshift(...this.queue.splice(index, 1));
      }
      return previous.value;
    }
    let resolve!: (file: CodeRepoFile) => void, reject!: (error: unknown) => void;
    const value = new Promise<CodeRepoFile>((yes, no) => { resolve = yes; reject = no; });
    const entry = { version: file.version ?? previous?.version, value };
    this.entries.set(key, entry);
    const job = { key, run: async () => {
      try { resolve(await this.load(file)); }
      catch (error) { if (this.entries.get(key) === entry) this.entries.delete(key); reject(error); }
    } };
    if (background) this.queue.push(job); else this.queue.unshift(job);
    this.drain();
    return value;
  }
  preload(files: readonly SourceFileRequest[]) {
    for (const file of files) void this.read(file, false, true).catch(() => { /* The pane can retry and report errors. */ });
  }
  private drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!; this.active++;
      void job.run().finally(() => { this.active--; this.drain(); });
    }
  }
}
