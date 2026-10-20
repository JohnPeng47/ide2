import { createHash } from 'node:crypto';
import type { RepositoryRegistry } from '../../../application/core/ports/repositoryRegistry';
import type { PushSource } from '../../../application/core/integrations/ports';
import type { PushEvent, RepositoryConnection } from '../../../domain/core/integrations/pushIntegration';
import { discoverRepository, execFileAsync } from '../persistence/shared';

export class GitPushSource implements PushSource {
  constructor(private readonly repositories: RepositoryRegistry,
    private readonly credentials: (name: string) => string | undefined = name => process.env[name]) {}
  private async root(connection: RepositoryConnection) {
    const repository = (await this.repositories.list()).find(repo => repo.id === connection.repositoryId);
    if (!repository) throw Error('Register the local repository before connecting its remote');
    for (const root of repository.checkoutRoots) {
      const discovered = await discoverRepository(root).catch(() => undefined);
      if (discovered?.repositoryIdentity === repository.identity) return root;
    }
    throw Error('Connected repository checkout is unavailable');
  }
  async validateConnection(connection: RepositoryConnection) { await this.root(connection); }
  async resolve(connection: RepositoryConnection, event: PushEvent) {
    if (!event.after) return { kind: 'delete' as const, commits: [], hasChanges: false };
    const root = await this.root(connection);
    const token = connection.credentialEnv ? this.credentials(connection.credentialEnv) : undefined;
    if (connection.credentialEnv && !token) throw Error(`Set ${connection.credentialEnv} on the server before fetching pushes`);
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1',
      GIT_CONFIG_COUNT: token ? '2' : '1', GIT_CONFIG_KEY_0: 'http.followRedirects', GIT_CONFIG_VALUE_0: 'false',
      ...(token ? { GIT_CONFIG_KEY_1: `http.${connection.remoteUrl}.extraHeader`, GIT_CONFIG_VALUE_1: `Authorization: Bearer ${token}` } : {}) };
    const git = async (...args: string[]) => (await execFileAsync('git', ['-C', root, ...args],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000, env })).stdout.trim();
    const hasCommit = async (sha: string) => {
      try { await git('cat-file', '-e', `${sha}^{commit}`); return true; } catch { return false; }
    };
    for (const sha of [...new Set([event.after, ...(event.before ? [event.before] : [])])]) {
      if (!await hasCommit(sha)) {
        try { await git('fetch', '--no-tags', '--no-write-fetch-head', '--', connection.remoteUrl, sha); }
        catch { throw Error(`Unable to fetch pushed commit ${sha}`); }
      }
      if (!await hasCommit(sha)) throw Error(`Push references unavailable commit ${sha}`);
    }
    if (await git('rev-parse', '--is-shallow-repository') === 'true') {
      throw Error('Push commit discovery requires a full clone; unshallow the registered repository');
    }
    // Always walk the pinned graph. Artifacts' commits[] may be truncated, and
    // branch HEAD may already have moved again by the time this event arrives.
    const commits = (await git('rev-list', '--reverse', '--topo-order', event.after,
      ...(event.before ? [`^${event.before}`] : []), '--')).split('\n').filter(Boolean);
    if (commits.length > 2000) throw Error('Push exceeds the supported 2000-commit limit');
    let kind: 'update' | 'new-branch' | 'force-push' = event.before ? 'update' : 'new-branch';
    if (event.before) {
      try { await git('merge-base', '--is-ancestor', event.before, event.after); }
      catch (error) {
        if ((error as { code?: number }).code !== 1) throw error;
        kind = 'force-push';
      }
    }
    const emptyTree = createHash(event.after.length === 64 ? 'sha256' : 'sha1').update('tree 0\0').digest('hex');
    const afterTree = await git('rev-parse', `${event.after}^{tree}`);
    const beforeTree = event.before ? await git('rev-parse', `${event.before}^{tree}`) : emptyTree;
    return { kind, commits, hasChanges: beforeTree !== afterTree };
  }
}
