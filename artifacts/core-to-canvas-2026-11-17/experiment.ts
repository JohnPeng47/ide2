// Preflight (zero model calls), then create the experiment, then (with --approve) launch generation.
// Idempotent: request IDs are kept in experiment-ids.json.
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { prepareRepositoryContext } from '../../infrastructure/core/agents/repositoryContext';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { renderPromptSections } from '../../domain/mapping/evals/promptTemplateBase';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const read = async (f: string) => JSON.parse(await readFile(path.join(directory, f), 'utf8'));
const write = (f: string, v: unknown) => writeFile(path.join(directory, f), JSON.stringify(v, null, 2) + '\n');
const exists = async (f: string) => { try { await access(path.join(directory, f)); return true; } catch { return false; } };
const api = async (route: string, body?: unknown) => {
  const r = await fetch('http://127.0.0.1:5191/api/mapping/evals' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw Error(`${route}: ${r.status} ${JSON.stringify(j)}`); return j;
};

const contexts: any[] = await read('contexts-receipt.json');
const promptReceipt = await read('prompt-receipt.json'), promptText = await readFile(path.join(directory, 'prompt.txt'), 'utf8');
const promptId = promptReceipt.id, version = promptReceipt.versions.at(-1).version;
const cellKey = `${promptId}:1:alternative`;

// --- Preflight: pinned prompt, pinned contexts, isolated checkouts at the pinned commits.
const live = await api(`/prompts/${promptId}`), pinned = live.versions.find((v: any) => v.version === version);
if (pinned.stages.alternative !== promptText) throw Error('Saved prompt differs from prompt.txt');
renderPromptSections(promptText, pinned.templateBase);
const library = new AgentContextLibrary(new FileAgentContextRepository(path.join(root, '.diagrams-local/canvas-domain-model')));
const preflight = [];
for (const c of contexts) {
  const saved = await library.read(c.agentContextId, false), context = AgentContext.fromSnapshot(saved.snapshot);
  if (context.contentHash !== c.contentHash) throw Error(`${c.name}: context hash changed`);
  const checkout = await prepareRepositoryContext(context);
  try {
    if (!checkout.cwd || checkout.tools.join(',') !== 'read,bash') throw Error(`${c.name}: no isolated checkout`);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout.cwd, encoding: 'utf8' }).trim();
    await writeFile(path.join(directory, `rendered-context-${c.key}.json`), JSON.stringify(checkout.context.toPiMessages(), null, 2));
    if (head !== c.commit) throw Error(`${c.name}: checkout at ${head}, expected ${c.commit}`);
    preflight.push({ name: c.name, agentContextId: c.agentContextId, contentHash: c.contentHash, commit: head, tools: checkout.tools });
  } finally { await checkout.close(); }
}
await write('preflight.json', { promptId, version, contentHash: pinned.contentHash, contexts: preflight });
console.log('Preflight passed (zero model calls):', preflight.map(p => `${p.name}@${p.commit.slice(0, 7)}`).join(', '));

// --- Experiment design.
const ids = await exists('experiment-ids.json') ? await read('experiment-ids.json')
  : { experimentRequestId: randomUUID(), approveRequestId: randomUUID(), runs: Object.fromEntries(contexts.map(c => [c.key, randomUUID()])) };
await write('experiment-ids.json', ids);
const request = { requestId: ids.experimentRequestId, experiment: {
  name: 'Core component → canvas',
  description: 'Restructure one Astra/high core component diagram per repository (from Core component discovery 08ccc7fa) into a vertical central diagram with connected peripheral diagrams. Repository checkout available to double-check the diagram. One gpt-6-astra/high canvas per repository.',
  tags: ['core-discovery', 'canvas'],
  workflow: { id: 'core-to-canvas', name: 'Core component to canvas', version: 1, stages: [{ id: 'split', name: 'Generate canvas', dependsOn: [] }] },
  cases: contexts.map(c => ({ id: c.key, name: c.name, agentContextId: c.agentContextId, contentHash: c.contentHash })),
  conditions: [{ id: 'vertical-framing', name: 'Vertical restructure', description: 'Horizontal/vertical framing with a podcast-player before/after example; seed diagram plus pinned checkout.' }],
  samples: contexts.map(c => ({ id: c.key, caseId: c.key, conditionId: 'vertical-framing', number: 1, attempt: 1, outputs: [] })),
  comparisons: [],
  plannedRuns: contexts.map(c => ({ request: { requestId: ids.runs[c.key], workflow: 'alternatives', prompts: [{ promptId, version }],
    inputs: { context: { agentContextId: c.agentContextId } }, passes: 1, model: 'gpt-6-astra', effort: 'high' },
    outputs: [{ sampleId: c.key, stageId: 'split', cellKey }] })),
} };
await write('experiment-request.json', request);
const experiment = await api('/experiments', request);
await write('experiment-receipt.json', experiment);
console.log('Experiment', experiment.id, 'revision', experiment.revision, 'review', experiment.generationReview?.status);

if (!process.argv.includes('--approve')) process.exit(0);
const approved = await api(`/experiments/${experiment.id}/approve`, { requestId: ids.approveRequestId, expectedRevision: experiment.revision });
await write('approval-receipt.json', approved);
console.log('Approved:', approved.generationReview?.status ?? approved.status);
