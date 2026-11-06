import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AgentContextLibrary } from '../../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../fileAgentContextRepository';
import { FileAgentContextSources } from '../fileAgentContextSources';
import { GitRepositoryRegistry } from '../repositoryRegistry';
import { DiagramStore } from '../store';

const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

it.each([false, true])('resolves pinned context sources after the original worktree is deleted (replacement registered=%s)', async registered => {
  const root = await mkdtemp(path.join(tmpdir(), 'repository-recovery-'));
  try {
    const checkout = path.join(root, 'checkout'), removed = path.join(root, 'removed');
    await mkdir(checkout); git(checkout, 'init', '-q');
    await writeFile(path.join(checkout, 'source.ts'), 'const captured = 42;\n');
    git(checkout, 'add', '.');
    git(checkout, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'source');
    git(checkout, 'worktree', 'add', '-q', '--detach', removed);
    const store = new DiagramStore(removed, path.join(root, 'store'));
    const project = await store.ensureProject({ checkoutRoot: removed, repositoryIdentity: '' });
    const repository = project.repositories![0];
    const library = (registry: GitRepositoryRegistry) => new AgentContextLibrary(new FileAgentContextRepository(store.storeRoot),
      new FileAgentContextSources(store.storeRoot, async id => ({ kind: 'git-worktree', root: await registry.resolveCheckoutRoot(id) })));
    const receipt = await library(store.repositories).create({ requestId: crypto.randomUUID(), name: 'Pinned source', context: [
      { type: 'sourceFile', sourceId: repository.id, path: 'source.ts', startLine: 1, endLine: 1 }
    ] });
    const registry = new GitRepositoryRegistry(store.storeRoot, checkout);
    if (registered) await registry.register({ path: checkout });
    git(checkout, 'worktree', 'remove', '--force', removed);
    await writeFile(path.join(checkout, 'source.ts'), 'const captured = 99;\n');
    expect(await registry.resolveCheckoutRoot(repository.id)).toBe(checkout);
    const read = await library(registry).read(receipt.agentContextId);
    expect(read.contentHash).toBe(receipt.contentHash);
    expect(read.resolvedSnapshot?.messages[0].content[0]).toEqual({ type: 'text', text: 'source.ts:1-1\nconst captured = 42;' });
    await expect(registry.resolveCheckoutRoot('repo-unknown')).rejects.toThrow('Unknown repositoryId');

    // A different repository can occupy a former checkout path; never trust the path alone.
    await mkdir(removed); git(removed, 'init', '-q');
    const unrelated = new GitRepositoryRegistry(store.storeRoot, removed);
    if (registered) expect(await unrelated.resolveCheckoutRoot(repository.id)).toBe(checkout);
    else await expect(unrelated.resolveCheckoutRoot(repository.id)).rejects.toThrow('Repository checkout is unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});
