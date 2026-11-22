import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { legacyPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';
import { experimentDesignSchema } from '../../../domain/mapping/evals/experiment';

// Setup only: no model runtime, launch endpoint, or runnable job is used here.
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const baseUrl = 'http://localhost:5191';
const read = async (file: string) => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
const write = async (file: string, value: unknown) => writeFile(path.join(directory, file), JSON.stringify(value, null, 2) + '\n');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const baseline = JSON.parse(await readFile(path.join(directory, '../baseline-01/inputs.json'), 'utf8'));
const parent = JSON.parse(await readFile(path.join(directory, '../baseline-01/ids.json'), 'utf8'));
const prompt = await readFile(path.join(directory, 'prompt.txt'), 'utf8');
const oldContext = JSON.parse(await readFile(path.join(directory, '../baseline-01/context.json'), 'utf8'));
const sourcePaths = new Set<string>(oldContext.sources.map((source: { path: string }) => source.path));
const commit = baseline.sourceCommit;
const actual = execFileSync('git', ['rev-parse', '--verify', `${commit}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
if (actual !== commit) throw Error('Pinned commit mismatch');
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', commit], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const allowedRoots = new Set(['src', 'application', 'domain', 'infrastructure', 'packages']);
const rootExclusions = new Set<string>();
for (const file of paths) if (!sourcePaths.has(file) && !allowedRoots.has(file.split('/')[0]))
  rootExclusions.add(file.includes('/') ? `${file.split('/')[0]}/**` : file);
const exclusions = [...rootExclusions, '**/__tests__/**', '**/__fixtures__/**', '**/fixtures/**', '**/*.test.*', '**/*.spec.*'].sort();
const excluded = (file: string) => exclusions.some(pattern => path.posix.matchesGlob(file, pattern));
for (const file of paths) if (!sourcePaths.has(file) && !excluded(file)) exclusions.push(file);
const available = paths.filter(file => !excluded(file));
if (available.length !== sourcePaths.size || available.some(file => !sourcePaths.has(file))) throw Error('Repository scope differs from baseline');
let ids: { promptId: string; contextRequestId: string; experimentId: string; sampleId: string; commentId: string };
try { ids = await read('ids.json'); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  ids = { promptId: randomUUID(), contextRequestId: randomUUID(), experimentId: randomUUID(), sampleId: randomUUID(), commentId: randomUUID() };
  await write('ids.json', ids);
}
const api = async (route: string, body?: unknown) => {
  const response = await fetch(baseUrl + '/api/mapping/evals' + route, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${route}: ${response.status} ${JSON.stringify(data)}`);
  return data;
};
const config = JSON.parse(await readFile(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'), 'utf8'));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const context = await contexts.create({ requestId: ids.contextRequestId, name: 'Core discovery repository', group: 'Core component discovery',
  description: `Incremental discovery at ${commit}; same ${sourcePaths.size} eligible files as baseline. No source bundle, reference diagram, or static-analysis rankings.`,
  context: [{ type: 'repository', repositoryPath: root, commit, exclusions,
    task: 'Identify the core component: the connected set of responsibilities around which the application’s main behavior and state are organized. Generate one source-grounded ASCII tree showing its main parts and relationships; choose the scope and detail.' }] });
const snapshot = (await contexts.read(context.agentContextId, false)).snapshot;
await write('context.json', snapshot);
await write('eligible-paths.json', available.sort());
const stages = { alternative: prompt };
const savedPrompt = await api('/prompts', { requestId: ids.promptId, workflow: 'alternatives', name: 'Core discovery · repository browsing',
  description: 'Open-ended core discovery with the user’s 3+1 model, 60/40 guidance and two synthetic examples; incremental browsing replaces the source bundle.',
  stages, templateBase: legacyPromptTemplateBase(stages), derivation: { parent: { promptId: parent.promptId, version: 1 }, kind: 'variation',
    dimension: { id: 'context-delivery', name: 'Context delivery', value: 'Incremental repository browsing' } } });
if (savedPrompt.versions[0].stages.alternative !== prompt) throw Error('Saved prompt differs from local draft');
const promptUrl = `${baseUrl}/evals?prompt=${ids.promptId}&version=1`;
const experimentUrl = `${baseUrl}/evals?experiment=${ids.experimentId}`;
const design = experimentDesignSchema.parse({ name: 'Core discovery · repository browsing',
  description: `Draft for prompt review. One gpt-6-astra/high sample is planned at ${commit}, with the same ${sourcePaths.size} eligible files as baseline. No generation has been queued or authorized. Prompt v1: ${promptUrl}`,
  workflow: { id: 'core-discovery', name: 'Core component discovery', version: 1, stages: [{ id: 'tree', name: 'Core diagram', dependsOn: [] }] },
  cases: [{ id: 'source', name: 'Pinned repository', agentContextId: context.agentContextId, contentHash: context.contentHash }],
  conditions: [{ id: 'repository-browsing', name: '3+1 · repository browsing', description: `Combined prompt v1 (${ids.promptId}); bounded incremental browsing; no reference diagram or analysis rankings. Output: one ASCII tree in JSON {ascii}, at most 20000 characters.` }],
  samples: [{ id: ids.sampleId, caseId: 'source', conditionId: 'repository-browsing', number: 1, attempt: 1, outputs: [] }], comparisons: [] });
await write('experiment-request.json', { requestId: ids.experimentId, experiment: design });
await api('/experiments', { requestId: ids.experimentId, experiment: design });
await api(`/experiments/${ids.experimentId}/comments`, { requestId: ids.commentId,
  text: `Prepared for review only. [Review combined prompt v1](${promptUrl}). Planned settings: one gpt-6-astra/high sample; pinned commit ${commit}; repository AgentContext ${context.agentContextId}. No run or model call has been created. The single-tree coordinator will validate {ascii} and materialize one Diagram after explicit execution authorization and deterministic preflight.`, tags: ['prompt-review'] });
const plan = { status: 'draft', executionAuthorized: false, modelCalls: 0, ...ids, promptVersion: 1,
  promptSha256: hash(prompt), savedPromptContentHash: savedPrompt.versions[0].contentHash,
  parentPrompt: { promptId: parent.promptId, version: 1 }, agentContextId: context.agentContextId, contextHash: context.contentHash,
  sourceCommit: commit, eligibleFiles: available.length, model: 'gpt-6-astra', effort: 'high', samples: 1,
  execution: { runtime: 'pi-agent-context', coordinator: 'canvas-discovery', output: { ascii: 'single ASCII tree, printable ASCII and LF, at most 20000 characters' },
    materialization: 'Validate raw {ascii}; deterministically wrap as one Diagram using scripts/evals/from-scratch/artifacts.ts single/materialize.',
    beforeGeneration: 'Explicit user execution authorization and deterministic pinned-input/storage preflight. No automatic repair generations.' },
  promptUrl, experimentUrl };
await write('setup.json', plan);
const stored = await api(`/experiments/${ids.experimentId}`);
if (stored.samples.some((sample: { outputs: unknown[] }) => sample.outputs.length) || stored.plannedRuns?.length || stored.generationReview)
  throw Error('Review draft unexpectedly contains executable runs');
console.log(JSON.stringify({ status: plan.status, promptUrl, experimentUrl, agentContextId: context.agentContextId, eligibleFiles: available.length, modelCalls: 0 }));
