import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { REPOSITORY_DISCOVERY_INSTRUCTIONS } from '../../../domain/core/agents/agentContextRepository';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { legacyPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';

// Revision only. This script never launches a run or imports a model runtime.
const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../../..');
const read = async (name: string) => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const write = async (name: string, value: unknown) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
for (const name of ['prompt.txt', 'context.json', 'setup.json', 'experiment-request.json']) {
  const target = name.replace(/\.(txt|json)$/, '-v1.$1');
  try { await copyFile(path.join(directory, name), path.join(directory, target), constants.COPYFILE_EXCL); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
const previous = await read('setup-v1.json');
let ids: { fork: string; contextComment: string; promptSave: string; experimentSave: string; experimentComment: string };
try { ids = await read('revision-2-ids.json'); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  ids = { fork: randomUUID(), contextComment: randomUUID(), promptSave: randomUUID(), experimentSave: randomUUID(), experimentComment: randomUUID() };
  await write('revision-2-ids.json', ids);
}
const originalPrompt = await readFile(path.join(directory, 'prompt-v1.txt'), 'utf8');
const oldParagraph = 'Start with repository_list and targeted repository_search calls, then inspect relevant files incrementally with repository_read. Respect the pinned commit and exclusions. Do not dump the entire repository or read bundled source archives. The browsing tools record inspected paths, blob hashes, and source ranges.';
if (!originalPrompt.includes(oldParagraph)) throw Error('Unexpected original prompt');
const prompt = originalPrompt.replace(oldParagraph,
  'Work directly in the checkout directory using your normal shell and file-reading tools. Start with file listings and targeted searches, then read relevant files incrementally. Respect the exclusions and keep the checkout unchanged. Do not dump the entire repository or read bundled source archives. Tool calls and results are retained in the session transcript.');
const config = JSON.parse(await readFile(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'), 'utf8'));
const store = new FileAgentContextRepository(config.storeRoot), contexts = new AgentContextLibrary(store);
const fork = await contexts.fork({ requestId: ids.fork, agentContextId: previous.agentContextId,
  expectedContentHash: previous.contextHash, name: 'Core discovery · checkout directory',
  description: 'Pinned checkout directory for normal shell/read tools. Exclusions are instructions; tool activity is retained in the session transcript.' });
const record = (await store.read(fork.agentContextId))!;
const snapshot = AgentContext.fromSnapshot(record.snapshot).withMessages(record.snapshot.messages.map(message => ({ ...message,
  content: message.content.map(block => block.type === 'repository' ? { ...block, instructions: REPOSITORY_DISCOVERY_INSTRUCTIONS } : block) }))).toSnapshot();
// Follow the AgentContext fork/edit/comment workflow without modifying the original context.
await writeFile(path.join(config.storeRoot, 'agent-contexts', `${fork.agentContextId}.json`), JSON.stringify({ ...record, snapshot }), { mode: 0o600 });
await contexts.addComment({ requestId: ids.contextComment, agentContextId: fork.agentContextId, expectedContentHash: snapshot.contentHash,
  text: 'Use the actual isolated checkout directory with standard shell/read tools; removed repository_* instructions and retained the pinned commit and exclusions.' });
const api = async (route: string, body?: unknown) => {
  const response = await fetch('http://localhost:5191/api/mapping/evals' + route, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw Error(`${route}: ${response.status} ${JSON.stringify(result)}`);
  return result;
};
const stages = { alternative: prompt };
let savedPrompt = await api(`/prompts/${previous.promptId}`);
if (savedPrompt.versions.length === 1) savedPrompt = await api('/prompts', { requestId: ids.promptSave,
  promptId: previous.promptId, baseVersion: 1, workflow: 'alternatives', name: 'Core discovery · checkout directory',
  description: 'Open-ended core discovery with the original 3+1 model and examples, using a real pinned checkout and normal shell/read tools.',
  stages, templateBase: legacyPromptTemplateBase(stages), note: 'Replace custom repository tools with direct checkout-directory access.' });
const version = savedPrompt.versions.find((version: { version: number }) => version.version === 2);
if (!version || version.stages.alternative !== prompt) throw Error('Saved prompt v2 differs from intended revision');
const promptUrl = `http://localhost:5191/evals?prompt=${previous.promptId}&version=2`;
const before = await api(`/experiments/${previous.experimentId}`);
if (before.plannedRuns?.length || before.samples.some((sample: { outputs: unknown[] }) => sample.outputs.length)) throw Error('Experiment is no longer an unexecuted draft');
const design = { name: 'Core discovery · checkout directory',
  description: `Draft for prompt review: one gpt-6-astra/high sample at ${previous.sourceCommit}, using normal shell/read tools in an actual checkout. The ${previous.eligibleFiles}-file baseline scope is expressed by exclusion instructions. No generation is queued or authorized. Prompt v2: ${promptUrl}`,
  workflow: before.workflow, cases: [{ ...before.cases[0], agentContextId: fork.agentContextId, contentHash: snapshot.contentHash }],
  conditions: [{ ...before.conditions[0], name: '3+1 · checkout directory', description: `Combined prompt v2 (${previous.promptId}); normal shell/read tools in a pinned checkout. No reference diagram or analysis rankings. Output: one ASCII tree in JSON {ascii}, at most 20000 characters.` }],
  samples: before.samples, comparisons: before.comparisons };
const request = { requestId: ids.experimentSave, experimentId: previous.experimentId, expectedRevision: before.revision, experiment: design };
if (before.cases[0].agentContextId !== fork.agentContextId) {
  await api('/experiments', request);
  await write('experiment-request.json', request);
}
await api(`/experiments/${previous.experimentId}/comments`, { requestId: ids.experimentComment,
  text: `Updated draft: [review prompt v2](${promptUrl}). The agent receives the actual pinned checkout as its working directory and uses standard shell/read tools. Exclusions are instructions; operations are preserved in the session transcript. This supersedes v1’s custom repository tools. Still one Astra/high sample planned, with no generation queued or executed.`, tags: ['prompt-review'] });
const next = { ...previous, promptVersion: 2, promptSha256: hash(prompt), savedPromptContentHash: version.contentHash,
  parentPrompt: { promptId: previous.promptId, version: 1 }, contextRequestId: ids.fork, agentContextId: fork.agentContextId,
  contextHash: snapshot.contentHash, previousAgentContextId: previous.agentContextId,
  execution: { ...previous.execution, tools: ['bash', 'read'], workingDirectory: 'Isolated checkout at the pinned source commit; prepared when execution is authorized.',
    exclusions: 'Instructions to the agent, not tool-enforced access restrictions.', inspectionRecord: 'Persisted native tool-call/result transcript.' }, promptUrl };
await writeFile(path.join(directory, 'prompt.txt'), prompt);
await write('context.json', snapshot);
await write('setup.json', next);
console.log(JSON.stringify({ status: next.status, promptUrl, experimentUrl: next.experimentUrl, agentContextId: next.agentContextId, modelCalls: 0 }));
