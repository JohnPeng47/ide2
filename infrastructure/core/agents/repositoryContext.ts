import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AgentContext, agentContextRepositories } from '../../../domain/core/agents/agentContext';
import { REPOSITORY_DISCOVERY_INSTRUCTIONS, repositoryContextSchema, type RepositoryContext, type RepositoryInspection } from '../../../domain/core/agents/agentContextRepository';

const exec = promisify(execFile);

/** Prepare a real checkout. The agent uses its standard tools directly against this directory. */
export class RepositoryCheckout {
  private constructor(readonly descriptor: RepositoryContext, readonly root: string, readonly directory: string) {}
  static async open(raw: RepositoryContext, signal?: AbortSignal) {
    const descriptor = repositoryContextSchema.parse(raw);
    if (descriptor.instructions !== REPOSITORY_DISCOVERY_INSTRUCTIONS)
      throw Error('REPOSITORY_CONTEXT_LEGACY: fork this context with directory-access instructions before execution');
    signal?.throwIfAborted();
    const root = await mkdtemp(path.join(tmpdir(), 'agent-repository-')), directory = path.join(root, 'checkout');
    const git = async (cwd: string, args: string[]) => (await exec('git', ['--no-replace-objects', '-C', cwd, ...args],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, signal })).stdout;
    try {
      const commit = (await git(descriptor.repositoryPath, ['rev-parse', '--verify', `${descriptor.commit}^{commit}`])).trim();
      if (commit !== descriptor.commit) throw Error('REPOSITORY_COMMIT_MISMATCH');
      await git(root, ['clone', '--quiet', '--local', '--no-checkout', '--', descriptor.repositoryPath, directory]);
      await git(directory, ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', 'checkout', '--quiet', '--detach', descriptor.commit]);
      return new RepositoryCheckout(descriptor, root, directory);
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  }
  async close() { await rm(this.root, { recursive: true, force: true }); }
}

export async function prepareRepositoryContext(context: AgentContext, signal?: AbortSignal) {
  const descriptors = agentContextRepositories(context.toSnapshot().messages), checkouts: RepositoryCheckout[] = [];
  const close = async () => { await Promise.all(checkouts.map(checkout => checkout.close())); };
  try {
    for (const descriptor of descriptors) checkouts.push(await RepositoryCheckout.open(descriptor, signal));
    let index = 0;
    const replace = (block: { type: string }) => {
      if (block.type !== 'repository') return block;
      const checkout = checkouts[index++];
      return { type: 'text', text: JSON.stringify({ ...checkout.descriptor, checkout: checkout.directory }, null, 2) };
    };
    const prepared = checkouts.length ? context.withMessages(context.toSnapshot().messages.map(message => ({ ...message,
      content: message.content.map(block => block.type === 'section' ? { ...block, content: block.content.map(replace) } : replace(block)) }))) : context;
    const inspections: RepositoryInspection[] = checkouts.map((checkout, index) => ({ repository: `repo-${index + 1}`,
      repositoryPath: checkout.descriptor.repositoryPath, commit: checkout.descriptor.commit, exclusions: checkout.descriptor.exclusions,
      checkout: checkout.directory, inspectionSource: 'session-transcript' }));
    return { context: prepared, cwd: checkouts[0]?.directory, tools: checkouts.length ? ['read', 'bash'] : [], inspections, close };
  } catch (error) { await close(); throw error; }
}
