import { captureGitHunks } from './repositoryHunks';
import type { RepositoryContext } from '../../../domain/core/repositories/repository';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RepositoryRegistry } from '../../../application/core/ports/repositoryRegistry';
import type { Repository } from '../../../domain/core/repositories/repository';
import { repositoryContextSchema } from '../../../domain/core/repositories/repository';
import type { ProjectRecord } from '../../../domain/core/records/domain';
import { discoverRepository, execFileAsync, readJsonIfExists, writeJsonAtomic } from './shared';

const queues = new Map<string, Promise<unknown>>();
export class GitRepositoryRegistry implements RepositoryRegistry {
  private readonly file: string;
  constructor(storeRoot: string, private readonly checkoutRoot: string) { this.file = path.join(storeRoot, 'project.json'); }
  private async serial<T>(run: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.file) ?? Promise.resolve()).catch(() => {}).then(run);
    queues.set(this.file, next);
    try { return await next; } finally { if (queues.get(this.file) === next) queues.delete(this.file); }
  }
  private async project() {
    const project = await readJsonIfExists<ProjectRecord>(this.file);
    if (!project) throw Error('Project is not initialized');
    return project;
  }
  private async discover(root: string, name?: string): Promise<Repository> {
    const location = await discoverRepository(root);
    return { id: `repo-${createHash('sha256').update(location.repositoryIdentity).digest('hex').slice(0, 24)}`,
      name: name?.trim() || path.basename(location.checkoutRoot), identity: location.repositoryIdentity, checkoutRoots: [location.checkoutRoot] };
  }
  /** Backfill only repository identities we can actually discover. Non-Git projects stay unassigned. */
  async initialize() {
    return this.serial(async () => {
      const project = await this.project();
      if (project.repositories !== undefined) return project;
      const repositories: Repository[] = [];
      const roots = new Set([this.checkoutRoot, ...(project.sources ?? []).filter(s => s.corpus.kind === 'git-worktree').map(s => s.corpus.root)]);
      for (const root of roots) {
        const repository = await this.discover(root).catch(() => undefined);
        if (!repository) continue;
        const prior = repositories.find(r => r.id === repository.id);
        if (prior) prior.checkoutRoots = [...new Set([...prior.checkoutRoots, ...repository.checkoutRoots])];
        else repositories.push(repository);
      }
      const next = { ...project, repositories };
      await writeJsonAtomic(this.file, next);
      return next;
    });
  }
  async list() { return (await this.initialize()).repositories ?? []; }
  async register(input: { path: string; name?: string }) {
    const found = await this.discover(input.path, input.name);
    await this.initialize();
    return this.serial(async () => {
      const project = await this.project(), repositories = [...(project.repositories ?? [])];
      const index = repositories.findIndex(repository => repository.id === found.id), prior = repositories[index];
      const repository = { ...found, name: input.name?.trim() || prior?.name || found.name,
        checkoutRoots: [...new Set([...(prior?.checkoutRoots ?? []), ...found.checkoutRoots])] };
      if (index < 0) repositories.push(repository); else repositories[index] = repository;
      await writeJsonAtomic(this.file, { ...project, repositories, updatedAt: new Date().toISOString() });
      return repository;
    });
  }
  private async availableRoot(repository: Repository) {
    let root: string | undefined;
    for (const candidate of repository.checkoutRoots) {
      const location = await discoverRepository(candidate).catch(() => undefined);
      if (location?.repositoryIdentity === repository.identity) { root = candidate; break; }
    }
    if (!root) throw Error('Repository checkout is unavailable');
    return root;
  }
  async captureHunks(context: RepositoryContext) {
    repositoryContextSchema.parse(context);
    const repository = (await this.list()).find(repo => repo.id === context.repositoryId);
    if (!repository) throw Error('Unknown repositoryId');
    return captureGitHunks(await this.availableRoot(repository), context);
  }
  async resolveContext(input: { repositoryId?: string; commits?: string[]; head?: string; comparisonBase?: string | null }) {
    const repositories = await this.list();
    const repository = input.repositoryId ? repositories.find(r => r.id === input.repositoryId) : repositories.length === 1 ? repositories[0] : undefined;
    if (!repository) throw Error('Specify a registered repositoryId for this ChangeSession');
    const root = await this.availableRoot(repository);
    const resolved = new Map<string, string>();
    const resolve = async (ref: string) => {
      if (resolved.has(ref)) return resolved.get(ref)!;
      try {
        const sha = (await execFileAsync('git', ['-C', root!, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' })).stdout.trim();
        resolved.set(ref, sha);
        return sha;
      } catch { throw Error(`Unknown commit in repository ${repository.name}: ${ref}`); }
    };
    const head = await resolve(input.head ?? 'HEAD');
    const commits = new Set<string>();
    for (const ref of input.commits ?? []) commits.add(await resolve(ref));
    return repositoryContextSchema.parse({ repositoryId: repository.id, head, commits: [...commits],
      ...(input.comparisonBase !== undefined ? { comparisonBase: input.comparisonBase === null ? null : await resolve(input.comparisonBase) } : {}) });
  }
}
