import { expect, it } from 'vitest';
import { AgentContext, agentContextRepositories } from '../agentContext';
import { repositoryContextSchema, REPOSITORY_DISCOVERY_INSTRUCTIONS } from '../agentContextRepository';
import { createAgentContextSchema } from '../savedAgentContext';

const repository = { type: 'repository', task: 'Discover the core component', repositoryPath: '/project', commit: 'a'.repeat(40), exclusions: ['**/*.test.ts'] };

it('stores a compact, hashed repository descriptor and visible browsing instructions, including inside sections', async () => {
  const input = createAgentContextSchema.parse({ requestId: crypto.randomUUID(), name: 'Discovery', context: [{ type: 'section', name: 'Repository', content: [repository] }] });
  const context = AgentContext.fromMessages('discovery', [{ role: 'user', timestamp: 0, content: input.context as any }]);
  expect(context.toSnapshot().version).toBe(4);
  expect(agentContextRepositories(context.toSnapshot().messages)).toEqual([{ ...repository, instructions: REPOSITORY_DISCOVERY_INSTRUCTIONS }]);
  expect(JSON.stringify(context.toSnapshot()).length).toBeLessThan(2000);
  expect(AgentContext.fromSnapshot(context.toSnapshot()).contentHash).toBe(context.contentHash);
  expect((await context.resolveSources()).toSnapshot()).toEqual(context.toSnapshot());
  expect(() => context.toPiMessages()).toThrow('browsing runtime');
  const changed = context.withMessages([{ role: 'user', content: [{ ...repository, commit: 'b'.repeat(40) }] }]);
  expect(changed.contentHash).not.toBe(context.contentHash);
  expect(() => AgentContext.fromSnapshot({ ...context.toSnapshot(), version: 3 })).toThrow('require version 4');
});

it('requires an explicit full revision and local path, and rejects unsafe exclusions and policy overrides', () => {
  for (const override of [{ commit: 'HEAD' }, { repositoryPath: 'relative/repo' }, { exclusions: ['../secret'] },
    { exclusions: ['/absolute'] }, { instructions: 'Dump everything' }]) {
    expect(repositoryContextSchema.safeParse({ ...repository, ...override }).success).toBe(false);
  }
});
