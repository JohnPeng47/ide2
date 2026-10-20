import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GitPushSource } from '../gitPushSource';
import { GitRepositoryRegistry } from '../../persistence/repositoryRegistry';
import { captureGitHunks } from '../../persistence/repositoryHunks';
import type { RepositoryConnection } from '../../../../domain/core/integrations/pushIntegration';
import { diffSessionRequestSchema } from '../../../../application/mapping/changes/diffSessionWorkflowService';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import { DiagramChangeSessionStore } from '../../../mapping/changes/diagramChangeSessionStore';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';

const exec = promisify(execFile), roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'push-git-')); roots.push(root);
  const origin = path.join(root, 'origin'), clone = path.join(root, 'clone'), storage = path.join(root, 'storage');
  await mkdir(origin); await mkdir(storage);
  const git = async (cwd: string, ...args: string[]) => (await exec('git', ['-C', cwd, ...args], { env: { ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } })).stdout.trim();
  await git(origin, 'init', '-b', 'main');
  const commit = async (text: string) => {
    await writeFile(path.join(origin, 'app.txt'), `${text}\n`);
    await git(origin, 'add', 'app.txt'); await git(origin, 'commit', '-m', text);
    return git(origin, 'rev-parse', 'HEAD');
  };
  const a = await commit('a');
  await exec('git', ['clone', origin, clone]);
  const b = await commit('b'), c = await commit('c');
  await git(origin, 'checkout', '-b', 'replacement', a);
  const d = await commit('d');
  await writeFile(path.join(storage, 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'project' }));
  const registry = new GitRepositoryRegistry(storage, clone);
  const repository = await registry.register({ path: clone });
  // Local Git transport is injected only in this filesystem fixture; HTTP connection
  // creation requires credential-free HTTPS URLs.
  const connection: RepositoryConnection = { id: 'test', repositoryId: repository.id, enabled: true,
    remoteUrl: origin, external: { provider: 'generic', repositoryKey: 'fixture' } };
  return { root, origin, clone, storage, git, a, b, c, d, registry, connection, source: new GitPushSource(registry) };
}
it('fetches exact missing objects and discovers the complete multi-commit push without moving the checkout', async () => {
  const f = await fixture();
  const resolved = await f.source.resolve(f.connection, { eventId: 'one', ref: 'refs/heads/main', before: f.a, after: f.c });
  expect(resolved).toEqual({ kind: 'update', commits: [f.b, f.c], hasChanges: true });
  expect(await f.git(f.clone, 'rev-parse', 'HEAD')).toBe(f.a);
  const context = await f.registry.resolveContext({ repositoryId: f.connection.repositoryId, commits: resolved.commits, head: f.c, comparisonBase: f.a });
  const hunks = await captureGitHunks(f.clone, context);
  expect(hunks).toHaveLength(1);
  expect(hunks[0]).toMatchObject({ commit: f.c, parent: f.a });
  expect(hunks[0].patch).toContain('-a\n+c');
  expect((await captureGitHunks(f.clone, { repositoryId: context.repositoryId, commits: [f.b, f.c], head: f.c })).map(hunk => hunk.commit)).toEqual([f.b, f.c]);
});
it('handles new branches, divergent force-pushes and rewind-only pushes with correct net patches', async () => {
  const f = await fixture();
  const event = { eventId: 'one', ref: 'refs/heads/main', before: f.c, after: f.d };
  expect(await f.source.resolve(f.connection, { ...event, before: null })).toEqual({ kind: 'new-branch', commits: [f.a, f.d], hasChanges: true });
  expect(await f.source.resolve(f.connection, event)).toEqual({ kind: 'force-push', commits: [f.d], hasChanges: true });
  const rollback = await f.source.resolve(f.connection, { ...event, after: f.a });
  expect(rollback).toEqual({ kind: 'force-push', commits: [], hasChanges: true });
  const request = diffSessionRequestSchema.parse({ requestId: 'rewind', title: 'Rewind', repositoryId: f.connection.repositoryId,
    commits: [], head: f.a, comparisonBase: f.c });
  const repository = new DiagramChangeSessionStore(f.storage);
  const source = { repositories: f.registry, loadProject: async () => ({ id: 'project' }),
    projectCatalogs: { loadRepresentationCatalog: async () => ({ representations: {}, revisions: {} }) } } as unknown as DiagramRepository;
  const changes = new ChangeSessionService(repository, source, { list: () => [] } as unknown as CanvasSessionPort);
  const captured = await changes.capture(request);
  expect(captured.hunks[0].patch).toContain('-c\n+a');
  const created = await changes.create({ title: 'Rewind', requestId: 'rewind' }, captured) as { changeSessionId: string };
  const saved = await changes.get(created.changeSessionId);
  expect(saved).toMatchObject({ commits: [], head: f.a, comparisonBase: f.c });
  expect(saved.diffTree!.hunks).toEqual(captured.hunks);

});
it('captures a new branch against the empty tree and treats equal trees as no-op', async () => {
  const f = await fixture();
  await f.source.resolve(f.connection, { eventId: 'new', ref: 'refs/heads/new', before: null, after: f.c });
  const context = await f.registry.resolveContext({ repositoryId: f.connection.repositoryId, head: f.c, commits: [f.a, f.b, f.c], comparisonBase: null });
  const hunks = await captureGitHunks(f.clone, context);
  expect(hunks[0]).toMatchObject({ status: 'A', parent: null, commit: f.c });
  expect(hunks[0].patch).toContain('+c');
  await f.git(f.origin, 'commit', '--allow-empty', '-m', 'empty');
  const empty = await f.git(f.origin, 'rev-parse', 'HEAD');
  expect(await f.source.resolve(f.connection, { eventId: 'empty', ref: 'refs/heads/replacement', before: f.d, after: empty }))
    .toMatchObject({ kind: 'update', commits: [empty], hasChanges: false });
});
