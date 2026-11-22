import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { LEGACY_REPOSITORY_DISCOVERY_INSTRUCTIONS, repositoryContextSchema } from '../../../../domain/core/agents/agentContextRepository';
import { AgentContextLibrary } from '../../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../persistence/fileAgentContextRepository';
import { RepositoryCheckout, prepareRepositoryContext } from '../repositoryContext';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'repository-context-test-')); roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'tests'));
  await writeFile(path.join(root, 'src/core.ts'), 'export class Diagram {}\nexport const core = new Diagram();\n');
  await writeFile(path.join(root, 'tests/core.test.ts'), 'excluded Diagram');
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  await writeFile(path.join(root, 'src/core.ts'), 'DIRTY WORKTREE');
  await writeFile(path.join(root, 'untracked.ts'), 'UNTRACKED');
  return { root, git, descriptor: repositoryContextSchema.parse({ type: 'repository', task: 'Discover core', repositoryPath: root, commit, exclusions: ['tests/**'] }) };
}

it('provides a real isolated directory at the pinned commit without changing the source worktree', async () => {
  const f = await fixture(), checkout = await RepositoryCheckout.open(f.descriptor);
  try {
    expect(checkout.directory.startsWith(f.root)).toBe(false);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout.directory, encoding: 'utf8' }).trim()).toBe(f.descriptor.commit);
    expect(await readFile(path.join(checkout.directory, 'src/core.ts'), 'utf8')).toContain('class Diagram');
    // Exclusions are instructions, not a filtered or virtual filesystem.
    expect(await readFile(path.join(checkout.directory, 'tests/core.test.ts'), 'utf8')).toBe('excluded Diagram');
    await expect(readFile(path.join(checkout.directory, 'untracked.ts'))).rejects.toThrow();
    await writeFile(path.join(checkout.directory, 'src/core.ts'), 'DISPOSABLE CHANGE');
    expect(await readFile(path.join(f.root, 'src/core.ts'), 'utf8')).toBe('DIRTY WORKTREE');
  } finally { await checkout.close(); }
  await expect(readFile(path.join(checkout.directory, 'src/core.ts'))).rejects.toThrow();
});

it('rejects unavailable commits, cancellation and legacy instructions before model execution', async () => {
  const f = await fixture();
  await expect(RepositoryCheckout.open({ ...f.descriptor, commit: 'f'.repeat(40) })).rejects.toThrow();
  await expect(RepositoryCheckout.open(f.descriptor, AbortSignal.abort())).rejects.toThrow();
  const legacy = AgentContext.fromMessages('legacy', [{ role: 'user', timestamp: 0,
    content: [{ ...f.descriptor, instructions: LEGACY_REPOSITORY_DISCOVERY_INSTRUCTIONS }] }]);
  expect(AgentContext.fromSnapshot(legacy.toSnapshot()).contentHash).toBe(legacy.contentHash);
  await expect(prepareRepositoryContext(legacy)).rejects.toThrow('REPOSITORY_CONTEXT_LEGACY');
});

it('keeps saved descriptors compact and gives the model a checkout path and standard tools', async () => {
  const f = await fixture(), library = new AgentContextLibrary(new FileAgentContextRepository(path.join(f.root, 'store')));
  const saved = await library.create({ requestId: crypto.randomUUID(), name: 'Discovery', group: 'Core evals', context: [f.descriptor] });
  const record = await library.read(saved.agentContextId);
  expect(record.resolvedSnapshot).toBeUndefined();
  expect(JSON.stringify(record)).not.toContain('class Diagram');
  const fork = await library.fork({ requestId: crypto.randomUUID(), agentContextId: saved.agentContextId, expectedContentHash: saved.contentHash, name: 'Fork' });
  expect(fork.contentHash).toBe(saved.contentHash);
  const prepared = await prepareRepositoryContext(AgentContext.fromSnapshot(record.snapshot));
  try {
    expect(prepared.tools).toEqual(['read', 'bash']);
    const content = prepared.context.toPiMessages()[0].content[0];
    if (content.type !== 'text') throw Error('Expected text');
    const supplied = JSON.parse(content.text);
    expect(supplied.checkout).toBe(prepared.cwd);
    expect(supplied.exclusions).toEqual(['tests/**']);
    expect(supplied.instructions).toContain('normal shell and file-reading tools');
    expect(content.text).not.toContain('class Diagram');
    expect(prepared.inspections[0]).toMatchObject({ commit: f.descriptor.commit, inspectionSource: 'session-transcript', checkout: prepared.cwd });
    expect(prepared.inspections[0].events).toBeUndefined();
  } finally { await prepared.close(); }
});
