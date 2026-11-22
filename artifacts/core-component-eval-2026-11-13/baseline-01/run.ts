import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelCall } from '../../../scripts/evals/from-scratch/model';
import { treeSchema, validateTree, single, preflight, materialize } from '../../../scripts/evals/from-scratch/artifacts';
import { DiagramStore } from '../../../infrastructure/core/persistence/store';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { legacyPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';
import { summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult';
import { experimentDesignSchema } from '../../../domain/mapping/evals/experiment';
import { cellKey } from '../../../domain/mapping/evals/evalRun';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const read = async (file: string) => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
const write = async (file: string, value: unknown) => writeFile(path.join(directory, file), JSON.stringify(value, null, 2) + '\n');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const inputs = await read('inputs.json');
const prompt = await readFile(path.join(directory, 'prompt.txt'), 'utf8');
const contextText = await readFile(path.join(directory, 'context.json'), 'utf8');
if (hash(prompt) !== inputs.promptSha256 || hash(contextText) !== inputs.files['context.json'].sha256) throw Error('Pinned input changed');
const context = JSON.parse(contextText);
for (const source of context.sources) if (hash(source.text) !== source.sha256) throw Error(`Source hash mismatch: ${source.path}`);
const previous = JSON.parse(await readFile(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'), 'utf8'));
const store = new DiagramStore(root, previous.storeRoot);
const project = await store.loadProject();
if (!project) throw Error('Project not found');
const probe = single(`Pinned source ${inputs.sourceCommit.slice(0, 7)}\n|-- ${context.sources[0].path}\n\`-- ${context.sources.at(-1).path}`);
await write('preflight.json', await preflight(probe, project.id, inputs.fingerprint));
console.log('Preflight passed: pinned inputs verified; materialize/save/restore/reopen/edit/output loading passed.');

let ids: { runId: string; promptId: string; experimentId: string };
try { ids = await read('ids.json'); }
catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  ids = { runId: randomUUID(), promptId: randomUUID(), experimentId: randomUUID() };
  await write('ids.json', ids);
}
const now = new Date().toISOString();
const prompts = new JsonDirectoryStore<any>(previous.storeRoot, 'eval-prompts');
const runs = new JsonDirectoryStore<any>(previous.storeRoot, 'eval-runs');
const experiments = new JsonDirectoryStore<any>(previous.storeRoot, 'eval-experiments');
const timeline = new FileCanvasTimeline(previous.storeRoot);
const contexts = new AgentContextLibrary(new FileAgentContextRepository(previous.storeRoot));
const blocks = [];
for (let i = 0; i < contextText.length; i += 900000) blocks.push({ type: 'text', text: contextText.slice(i, i + 900000) });
const inputContext = await contexts.create({ requestId: ids.runId, name: 'Core discovery source', group: 'Core component discovery',
  description: `Pinned context.json at ${inputs.sourceCommit}; ${inputs.sourceFiles} files; ${inputs.fingerprint}. No reference diagram or static-analysis rankings.`, context: blocks });
const stages = { alternative: prompt };
let promptRecord = await prompts.read(ids.promptId);
if (!promptRecord) {
  promptRecord = { schemaVersion: 1, id: ids.promptId, projectId: project.id, workflow: 'alternatives', name: 'Core discovery baseline',
    description: 'User 3+1 prompt, two supplied synthetic examples and 60/40 guidance, with open-ended core discovery instruction.', createdAt: now, updatedAt: now,
    versions: [{ version: 1, createdAt: now, format: 'explicit-v1', templateBase: legacyPromptTemplateBase(stages), stages, contentHash: hash(JSON.stringify(stages)) }] };
  await prompts.save(promptRecord);
}
const key = cellKey(ids.promptId, 1, 'alternative');
const request = { requestId: ids.runId, workflow: 'alternatives', prompts: [{ promptId: ids.promptId, version: 1 }], inputs: { context: { agentContextId: inputContext.agentContextId } }, passes: 1, model: 'gpt-6-astra', effort: 'high' };
let run = await runs.read(ids.runId);
if (!run) run = { schemaVersion: 1, id: ids.runId, coordinator: 'canvas-discovery', requestHash: hash(JSON.stringify(request)), request, projectId: project.id,
  workflow: 'alternatives', agentContextId: inputContext.agentContextId, contextName: inputContext.name,
  prompts: [{ promptId: ids.promptId, version: 1, name: promptRecord.name, ...promptRecord.versions[0] }], inputs: {}, contexts: { context: inputContext },
  status: 'queued', createdAt: now, name: 'Core discovery baseline', cells: [{ key, promptId: ids.promptId, promptVersion: 1, promptName: promptRecord.name, pass: 1, stage: 'alternative', status: 'queued', candidateName: 'Core component' }] };
await runs.save(run);
const design = experimentDesignSchema.parse({ name: 'Core component discovery', description: `Baseline: one gpt-6-astra/high generation from ${inputs.sourceFiles} pinned source files at ${inputs.sourceCommit}. User's two synthetic examples and 60/40 guidance. No supplied static-analysis rankings or reference diagram.`,
  phases: [{ id: 'baseline', name: 'Generate baseline', description: 'One single-tree output; no judge or automatic repair calls.' }],
  workflow: { id: 'core-discovery', name: 'Core component discovery', version: 1, stages: [{ id: 'tree', name: 'Core diagram', dependsOn: [] }] },
  cases: [{ id: 'source', name: 'Pinned codebase', agentContextId: inputContext.agentContextId, contentHash: inputContext.contentHash }],
  conditions: [{ id: 'baseline', name: '3+1 baseline', description: 'Open-ended scope, two synthetic examples, 60/40 code references and natural language.' }],
  samples: [{ id: ids.runId, phaseId: 'baseline', caseId: 'source', conditionId: 'baseline', number: 1, attempt: 1, outputs: [{ stageId: 'tree', runId: ids.runId, cellKey: key }] }], comparisons: [] });
if (!await experiments.read(ids.experimentId)) await experiments.save({ ...design, schemaVersion: 1, id: ids.experimentId, projectId: project.id, revision: 1, createdAt: now, updatedAt: now, lastRequest: { id: ids.experimentId, hash: hash(JSON.stringify(design)) } });
console.log(JSON.stringify({ ...ids, sourceFiles: inputs.sourceFiles, model: 'gpt-6-astra', effort: 'high', samples: 1 }));
try {
  run.status = 'generating'; Object.assign(run.cells[0], { status: 'generating', startedAt: new Date().toISOString() }); await runs.save(run);
  await write('status.json', { status: 'generating', ...ids });
  const response = await modelCall(directory, prompt, treeSchema, new AbortController().signal);
  const output = treeSchema.parse(response.output);
  const nodes = validateTree(output.ascii);
  await write('validated-output.json', output);
  await writeFile(path.join(directory, 'diagram.ascii.txt'), output.ascii);
  await write('output-preflight.json', await preflight(single(output.ascii), project.id, hash(output.ascii)));
  let existing;
  try { existing = await timeline.read(ids.runId); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (!existing) {
    const history = materialize(single(output.ascii), ids.runId);
    const ref = { documentId: ids.runId, name: 'Core component baseline', viewId: history.canvasViews!.activeViewId!, checkpointId: history.headId };
    await timeline.append(ids.runId, project.id, 0, { id: 'output', phase: 'execution', title: 'Core component baseline', commits: [inputs.sourceCommit], agentContextId: inputContext.agentContextId, planId: ids.promptId, runId: ids.runId, canvases: [ref] }, { [ids.runId]: history });
  }
  const result = await timeline.result(ids.runId, 'output');
  Object.assign(run.cells[0], { status: 'finished', historyArtifact: { timelineId: ids.runId, stepId: 'output' }, output: summarizeEvalOutput(result), usage: response.usage, completedAt: new Date().toISOString() });
  run.status = 'finished'; run.completedAt = run.cells[0].completedAt; delete run.error; delete run.cells[0].error; await runs.save(run);
  const done = { status: 'finished', ...ids, characters: output.ascii.length, lines: output.ascii.split('\n').length, nodes: nodes.length, usage: response.usage };
  await write('status.json', done); console.log(JSON.stringify(done));
} catch (e) {
  const error = e instanceof Error ? e.message : String(e);
  run.status = 'failed'; run.error = error; Object.assign(run.cells[0], { status: 'failed', error }); await runs.save(run);
  await write('status.json', { status: 'failed', error, ...ids }); throw e;
}
