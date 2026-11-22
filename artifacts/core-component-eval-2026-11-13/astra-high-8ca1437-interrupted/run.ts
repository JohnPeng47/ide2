import { readFile, writeFile, appendFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { AgentContextEvalRuntime } from '../../../infrastructure/mapping/evals/agentContextEvalRuntime';
import { prepareRepositoryContext } from '../../../infrastructure/core/agents/repositoryContext';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { DiagramStore } from '../../../infrastructure/core/persistence/store';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { cellKey, evalRunRequestSchema, type EvalRun } from '../../../domain/mapping/evals/evalRun';
import { experimentDesignSchema } from '../../../domain/mapping/evals/experiment';
import { summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult';
import { treeSchema, validateTree, single, preflight, materialize } from '../../../scripts/evals/from-scratch/artifacts';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../../..');
const read = async (name: string) => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const write = async (name: string, value: unknown) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const api = async (route: string, body?: unknown) => {
  const response = await fetch('http://localhost:5191/api/mapping/evals' + route, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw Error(`${route}: ${response.status} ${JSON.stringify(result)}`);
  return result;
};
const plan = await read('setup.json');
if (plan.model !== 'gpt-6-astra' || plan.effort !== 'high' || plan.samples !== 1 || plan.promptVersion !== 2) throw Error('Unexpected generation settings');
const prompt = await readFile(path.join(directory, 'prompt.txt'), 'utf8');
if (hash(prompt) !== plan.promptSha256) throw Error('Local prompt changed after review');
const promptRecord = await api(`/prompts/${plan.promptId}`);
const pinnedPrompt = promptRecord.versions.find((version: { version: number }) => version.version === plan.promptVersion);
if (!pinnedPrompt || pinnedPrompt.stages.alternative !== prompt || pinnedPrompt.contentHash !== plan.savedPromptContentHash) throw Error('Saved prompt changed after review');
const config = JSON.parse(await readFile(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'), 'utf8'));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const savedContext = await contexts.read(plan.agentContextId, false);
if (savedContext.contentHash !== plan.contextHash || AgentContext.fromSnapshot(await read('context.json')).contentHash !== plan.contextHash) throw Error('Pinned context changed');
const context = AgentContext.fromSnapshot(savedContext.snapshot);
const store = new DiagramStore(root, config.storeRoot), project = await store.loadProject();
if (!project) throw Error('Project unavailable');
let ids: { runId: string; attachRequestId: string; startCommentId: string; completionCommentId: string };
try { ids = await read('run-ids.json'); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  ids = { runId: randomUUID(), attachRequestId: randomUUID(), startCommentId: randomUUID(), completionCommentId: randomUUID() };
  await write('run-ids.json', ids);
}
class RecordedRuntime extends AgentContextEvalRuntime {
  transcript?: string;
  events: Promise<unknown> = Promise.resolve();
  async checkModel() { const configured = await this.model(plan.model); return { provider: configured.provider, model: configured.modelId }; }
  protected async createSession(configuration: Omit<CreateAgentSessionOptions, 'sessionManager'>, context?: AgentContext) {
    const result = await super.createSession(configuration, context);
    this.transcript = result.session.sessionFile;
    await write('runtime-session.json', { sessionId: result.session.sessionId, transcript: this.transcript,
      cwd: configuration.cwd, tools: configuration.tools, contextHash: context?.contentHash, model: plan.model, effort: plan.effort });
    result.session.subscribe(event => {
      if (!['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end', 'message_end'].includes(event.type)) return;
      this.events = this.events.then(() => appendFile(path.join(directory, 'events.jsonl'), JSON.stringify(event) + '\n'));
      if (event.type === 'tool_execution_start') console.log(JSON.stringify({ status: 'inspecting', tool: event.toolName, args: event.args }));
      if (event.type === 'message_end' && event.message.role === 'assistant') console.log(JSON.stringify({ status: 'model-turn', stopReason: event.message.stopReason, usage: event.message.usage }));
    });
    return result;
  }
  async flush() {
    await this.events;
    if (this.transcript) await copyFile(this.transcript, path.join(directory, 'transcript.jsonl'));
  }
}
const runtime = new RecordedRuntime(root, true);
const model = await runtime.checkModel();
const prepared = await prepareRepositoryContext(context);
try {
  if (prepared.tools.join(',') !== 'read,bash' || !prepared.cwd) throw Error('Expected ordinary tools in an isolated checkout');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: prepared.cwd, encoding: 'utf8' }).trim() !== plan.sourceCommit) throw Error('Wrong checkout commit');
  const eligible: string[] = await read('eligible-paths.json');
  const sourcePath = eligible[0], sourceLine = (await readFile(path.join(prepared.cwd, sourcePath), 'utf8')).split('\n')[0].replace(/[^\x20-\x7e]/g, '?');
  const probe = single(`Pinned checkout ${plan.sourceCommit}\n|-- ${sourcePath}\n|   \`-- ${sourceLine}\n\`-- Eligible files: ${eligible.length}`);
  await write('preflight.json', { ...await preflight(probe, project.id, hash(plan.contextHash + plan.promptSha256)),
    model, contextHash: plan.contextHash, promptSha256: plan.promptSha256, sourceCommit: plan.sourceCommit, tools: prepared.tools,
    checkoutVerified: true, sourcePath, sourceLineHash: hash(sourceLine) });
} finally { await prepared.close(); }
console.log('Preflight passed: pinned checkout, model availability and storage lifecycle; zero model calls.');
if (!process.argv.includes('--execute')) { runtime.dispose(); process.exit(0); }

const runs = new JsonDirectoryStore<EvalRun>(config.storeRoot, 'eval-runs');
const key = cellKey(plan.promptId, 1, 'alternative');
let run = await runs.read(ids.runId);
if (run?.status === 'finished') { console.log(JSON.stringify({ status: 'finished', reused: true, runId: ids.runId })); process.exit(0); }
const request = evalRunRequestSchema.parse({ requestId: ids.runId, workflow: 'alternatives', prompts: [{ promptId: plan.promptId, version: plan.promptVersion }],
  inputs: { context: { agentContextId: plan.agentContextId } }, passes: 1, model: plan.model, effort: plan.effort });
run ??= { schemaVersion: 1, id: ids.runId, coordinator: 'canvas-discovery', request, requestHash: hash(JSON.stringify(request)),
  projectId: project.id, workflow: 'alternatives', agentContextId: plan.agentContextId, contextName: savedContext.name,
  prompts: [{ ...pinnedPrompt, promptId: plan.promptId, name: promptRecord.name }], inputs: {},
  contexts: { context: { agentContextId: plan.agentContextId, name: savedContext.name, contentHash: plan.contextHash } },
  name: 'Core discovery · matched snapshot', status: 'queued', createdAt: new Date().toISOString(),
  cells: [{ key, promptId: plan.promptId, promptVersion: plan.promptVersion, promptName: promptRecord.name, pass: 1, stage: 'alternative', status: 'queued', candidateName: 'Core component' }] };
let phase = 'orchestration';
try {
  await runs.save(run);
  const experiment = await api(`/experiments/${plan.experimentId}`);
  const design = experimentDesignSchema.parse(Object.fromEntries(['name', 'description', 'workflow', 'phases', 'cases', 'conditions', 'samples', 'comparisons'].filter(name => experiment[name] !== undefined).map(name => [name, experiment[name]])));
  const sample = design.samples.find(sample => sample.id === plan.sampleId)!;
  if (sample.outputs.length && !sample.outputs.some(output => output.runId === ids.runId && output.cellKey === key)) throw Error('Sample already has another run');
  if (!sample.outputs.length) {
    sample.outputs.push({ stageId: 'tree', runId: ids.runId, cellKey: key });
    // The setup retains both source snapshots and their own provenance.
    await api('/experiments', { requestId: ids.attachRequestId, experimentId: experiment.id, expectedRevision: experiment.revision, experiment: design });
  }
  let response;
  try { response = await read('response.json'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!response) {
    // An exclusive marker prevents accidental second generations after interruption or failure.
    await writeFile(path.join(directory, 'model-started.json'), JSON.stringify({ runId: ids.runId, at: new Date().toISOString(),
      promptVersion: plan.promptVersion, contextHash: plan.contextHash, model: plan.model, effort: plan.effort,
      authorization: 'User requested rerun at the diagram source snapshot' }), { flag: 'wx' });
    phase = 'generation'; run.status = 'generating'; Object.assign(run.cells[0], { status: 'generating', startedAt: new Date().toISOString() });
    await runs.save(run); await write('status.json', { status: 'generating', runId: ids.runId, promptVersion: plan.promptVersion });
    response = await runtime.generate({ workflow: 'alternatives', stage: 'alternative', prompt, schema: treeSchema,
      agentContext: savedContext.snapshot, files: {}, model: plan.model, effort: plan.effort, signal: new AbortController().signal });
    await write('response.json', response); await runtime.flush();
  }
  phase = 'validation';
  const output = treeSchema.parse(response.output), nodes = validateTree(output.ascii);
  await write('validated-output.json', output); await writeFile(path.join(directory, 'diagram.ascii.txt'), output.ascii);
  await write('output-preflight.json', await preflight(single(output.ascii), project.id, hash(output.ascii)));
  phase = 'materialization';
  const timeline = new FileCanvasTimeline(config.storeRoot);
  let existing;
  try { existing = await timeline.read(ids.runId); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!existing) {
    const history = materialize(single(output.ascii), ids.runId);
    const ref = { documentId: ids.runId, name: 'Core component', viewId: history.canvasViews!.activeViewId!, checkpointId: history.headId };
    await timeline.append(ids.runId, project.id, 0, { id: 'output', phase: 'execution', title: 'Core component', commits: [plan.sourceCommit],
      agentContextId: plan.agentContextId, planId: plan.promptId, runId: ids.runId, canvases: [ref] }, { [ids.runId]: history });
  }
  const result = await timeline.result(ids.runId, 'output');
  Object.assign(run.cells[0], { status: 'finished', historyArtifact: { timelineId: ids.runId, stepId: 'output' }, output: summarizeEvalOutput(result),
    usage: response.usage, execution: response.execution, completedAt: new Date().toISOString() });
  run.status = 'finished'; run.completedAt = run.cells[0].completedAt; delete run.error; delete run.cells[0].error;
  await runs.save(run);
  const status = { status: 'finished', runId: ids.runId, experimentId: plan.experimentId, characters: output.ascii.length,
    lines: output.ascii.split('\n').length, nodes: nodes.length, usage: response.usage, execution: response.execution,
    outputUrl: `http://localhost:5191/evals?run=${ids.runId}&output=${encodeURIComponent(key)}` };
  await write('status.json', status);
  console.log(JSON.stringify(status));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  run.status = 'failed'; run.error = message; Object.assign(run.cells[0], { status: 'failed', error: message, completedAt: new Date().toISOString() });
  await runs.save(run); await write('status.json', { status: 'failed', phase, runId: ids.runId, error: message });
  throw error;
} finally { await runtime.flush(); runtime.dispose(); }
