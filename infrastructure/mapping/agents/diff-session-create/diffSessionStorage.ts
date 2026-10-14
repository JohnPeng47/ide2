import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { publishJson } from '../../../core/persistence/immutableRecords';
import type { RepositoryRegistry } from '../../../../application/core/ports/repositoryRegistry';
import type { ChangeSessionCapture } from '../../../../application/mapping/changes/changeSessionService';
import type { DiffSessionRun, DiffSessionRunStore } from '../../../../application/mapping/changes/diffSessionWorkflowService';
import type { DiffSessionSourceReader } from '../../../../application/mapping/changes/diffSessionTools';

export class FileDiffSessionRunStore implements DiffSessionRunStore {
  constructor(private readonly root: string) {}
  private directory(id: string) {
    if (!/^diff-run-[a-f0-9]{32}$/.test(id)) throw Error('Invalid workflow run ID');
    return path.join(this.root, 'diff-session-workflows', id);
  }
  async create(run: DiffSessionRun) {
    const directory = this.directory(run.id); await mkdir(directory, { recursive: true });
    try { await writeFile(path.join(directory, 'run.json'), JSON.stringify(run), { flag: 'wx' }); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  }
  async read(id: string): Promise<DiffSessionRun | undefined> {
    try { return JSON.parse(await readFile(path.join(this.directory(id), 'run.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  save(run: DiffSessionRun) { return publishJson(path.join(this.directory(run.id), 'run.json'), run); }
  artifact(id: string, name: string, data: unknown) {
    if (!/^[a-z-]+$/.test(name)) throw Error('Invalid artifact name');
    return publishJson(path.join(this.directory(id), `${name}.json`), data);
  }
}
export async function loadDiffSessionPrompts() {
  const [analyze, materialize] = await Promise.all(['analyze', 'materialize'].map(name => readFile(new URL(`./prompts/${name}.md`, import.meta.url), 'utf8')));
  return { analyze, materialize };
}
const git = promisify(execFile);
export async function createDiffSessionSourceReader(registry: RepositoryRegistry, capture: ChangeSessionCapture): Promise<DiffSessionSourceReader> {
  const context = capture.context!;
  const repository = (await registry.list()).find(repo => repo.id === context.repositoryId);
  if (!repository) throw Error('Captured repository is no longer registered');
  let root: string | undefined;
  for (const candidate of repository.checkoutRoots) {
    try { await git('git', ['-C', candidate, 'cat-file', '-e', `${context.head}^{commit}`]); root = candidate; break; } catch { /* Try another registered checkout. */ }
  }
  if (!root) throw Error('No registered checkout contains the pinned head');
  const allowed = new Set([context.head, ...context.commits, ...capture.hunks.map(hunk => hunk.parent).filter(Boolean)]);
  return async input => {
    const revision = input.revision ?? context.head;
    if (!allowed.has(revision)) throw Error('Source reads must use the pinned head, a selected commit or a captured parent');
    if (input.path.startsWith('/') || input.path.split('/').includes('..') || /[\0\r\n]/.test(input.path)) throw Error('Expected a repository-relative path');
    const { stdout } = await git('git', ['-C', root!, 'show', `${revision}:${input.path}`], { maxBuffer: 8 * 1024 * 1024 });
    const lines = stdout.split('\n');
    return { path: input.path, revision, totalLines: lines.length, startLine: input.startLine,
      lines: lines.slice(input.startLine - 1, input.startLine - 1 + input.limit).map((text, index) => ({ line: input.startLine + index, text })) };
  };
}
