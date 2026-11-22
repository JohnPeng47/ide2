import { readFile, writeFile, appendFile, copyFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const read = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const write = async (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const exists = async (file: string) => { try { await access(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
const api = async (route: string, body?: unknown) => {
  const response = await fetch('http://localhost:5191/api/mapping/evals' + route, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw Error(`${route}: ${response.status} ${JSON.stringify(result)}`);
  return result;
};
const plan = await read(path.join(directory, 'inputs.json'));
if (plan.model !== 'gpt-6-astra' || plan.effort !== 'high' || plan.samples !== 3 || plan.cases.length !== 3) throw Error('Unexpected model/sample settings');
const prompt = await readFile(path.join(directory, 'prompt.txt'), 'utf8');
if (hash(prompt) !== plan.promptSha256) throw Error('Pinned prompt changed');
const promptRecord = await api(`/prompts/${plan.promptId}`);
const pinnedPrompt = promptRecord.versions.find((version: { version: number }) => version.version === plan.promptVersion);
if (!pinnedPrompt || pinnedPrompt.stages.alternative !== prompt || pinnedPrompt.contentHash !== plan.savedPromptContentHash) throw Error('Saved prompt differs from pinned version');
const config = await read(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const savedContext = await contexts.read(plan.agentContextId, false);
const context = AgentContext.fromSnapshot(savedContext.snapshot);
if (context.contentHash !== plan.contextHash || AgentContext.fromSnapshot(await read(path.join(directory, 'context.json'))).contentHash !== plan.contextHash) throw Error('Pinned context changed');
const project = await new DiagramStore(root, config.storeRoot).loadProject();
if (!project) throw Error('Project unavailable');
class RecordedRuntime extends AgentContextEvalRuntime {
  transcript?: string;
  events: Promise<unknown> = Promise.resolve();
  constructor(private readonly artifactDirectory: string, private readonly sample: number) { super(root, true); }
  async checkModel() { const configured = await this.model(plan.model); return { provider: configured.provider, model: configured.modelId }; }
  protected async createSession(configuration: Omit<CreateAgentSessionOptions, 'sessionManager'>, context?: AgentContext) {
    const result = await super.createSession(configuration, context);
    this.transcript = result.session.sessionFile;
    await write(path.join(this.artifactDirectory, 'runtime-session.json'), { sessionId: result.session.sessionId, transcript: this.transcript,
      cwd: configuration.cwd, tools: configuration.tools, contextHash: context?.contentHash, model: plan.model, effort: plan.effort });
    result.session.subscribe(event => {
      if (!['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end', 'message_end'].includes(event.type)) return;
      this.events = this.events.then(() => appendFile(path.join(this.artifactDirectory, 'events.jsonl'), JSON.stringify(event) + '\n'));
      if (event.type === 'tool_execution_start') console.log(JSON.stringify({ sample: this.sample, status: 'inspecting', tool: event.toolName, args: event.args }));
      if (event.type === 'message_end' && event.message.role === 'assistant') console.log(JSON.stringify({ sample: this.sample, status: 'model-turn', stopReason: event.message.stopReason, usage: event.message.usage }));
    });
    return result;
  }
  async flush() { await this.events; if (this.transcript) await copyFile(this.transcript, path.join(this.artifactDirectory, 'transcript.jsonl')); }
}
const checkRuntime = new RecordedRuntime(directory, 0);
const model = await checkRuntime.checkModel(); checkRuntime.dispose();
const prepared = await prepareRepositoryContext(context);
try {
  if (!prepared.cwd || prepared.tools.join(',') !== 'read,bash') throw Error('Expected an isolated directory and native tools');
  const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: prepared.cwd, encoding: 'utf8' }).trim();
  if (actualCommit !== plan.sourceCommit) throw Error('Wrong checkout commit');
  const paths: string[] = await read(path.join(directory, 'eligible-paths.json'));
  const sourcePath = paths[0], sourceLine = (await readFile(path.join(prepared.cwd, sourcePath), 'utf8')).split('\n')[0].replace(/[^\x20-\x7e]/g, '?');
  const probe = single(`Pinned checkout ${actualCommit}\n|-- ${sourcePath}\n|   \`-- ${sourceLine}\n\`-- Eligible files: ${paths.length}`);
  await write(path.join(directory, 'preflight.json'), { ...await preflight(probe, project.id, hash(plan.contextHash + plan.promptSha256)),
    model, contextHash: plan.contextHash, promptSha256: plan.promptSha256, sourceCommit: actualCommit, tools: prepared.tools, sourcePath, sourceLineHash: hash(sourceLine) });
} finally { await prepared.close(); }
console.log('Preflight passed: Astra availability, shared pinned inputs, isolated checkout, and storage lifecycle; zero model calls.');
if (!process.argv.includes('--execute')) process.exit(0);

const runs = new JsonDirectoryStore<EvalRun>(config.storeRoot, 'eval-runs');
const key = cellKey(plan.promptId, 1, 'alternative');
const entries: Array<{ number: number; runId: string; sampleId: string; directory: string; run: EvalRun }> = [];
for (const sample of plan.cases) {
  const sampleDirectory = path.join(directory, `sample-${sample.number}`); await mkdir(sampleDirectory, { recursive: true });
  let run = await runs.read(sample.runId);
  if (await exists(path.join(sampleDirectory, 'model-started.json')) && !await exists(path.join(sampleDirectory, 'response.json')))
    throw Error(`Sample ${sample.number} already started without a saved response; refusing another generation`);
  const request = evalRunRequestSchema.parse({ requestId: sample.runId, workflow: 'alternatives', prompts: [{ promptId: plan.promptId, version: plan.promptVersion }],
    inputs: { context: { agentContextId: plan.agentContextId } }, passes: 1, model: plan.model, effort: plan.effort });
  run ??= { schemaVersion: 1, id: sample.runId, coordinator: 'canvas-discovery', request, requestHash: hash(JSON.stringify(request)),
    projectId: project.id, workflow: 'alternatives', agentContextId: plan.agentContextId, contextName: savedContext.name,
    prompts: [{ ...pinnedPrompt, promptId: plan.promptId, name: promptRecord.name }], inputs: {},
    contexts: { context: { agentContextId: plan.agentContextId, name: savedContext.name, contentHash: plan.contextHash } },
    name: `${plan.repositoryName} discovery · Astra ${sample.number}`, status: 'queued', createdAt: new Date().toISOString(),
    cells: [{ key, promptId: plan.promptId, promptVersion: plan.promptVersion, promptName: promptRecord.name, pass: 1, stage: 'alternative', status: 'queued', candidateName: `${plan.repositoryName} core · Astra ${sample.number}` }] };
  await runs.save(run); entries.push({ ...sample, directory: sampleDirectory, run });
}
const experiment = await api(`/experiments/${plan.experimentId}`);
const inputCase = experiment.cases.find((c: { id: string }) => c.id === plan.caseId);
if (!inputCase || inputCase.agentContextId !== plan.agentContextId || inputCase.contentHash !== plan.contextHash) throw Error('Pinned input case mismatch');
for (const sample of entries) {
 const attached = experiment.samples.find((s: { id: string }) => s.id === sample.sampleId);
 if (!attached || attached.phaseId !== plan.phaseId || !attached.outputs.some((o: { runId: string; cellKey: string }) => o.runId === sample.runId && o.cellKey === key)) throw Error('Sample attachment mismatch');
}
async function generate(sample: typeof entries[number]) {
  const run = sample.run, runtime = new RecordedRuntime(sample.directory, sample.number);
  if (run.status === 'finished') return read(path.join(sample.directory, 'status.json'));
  let phase = 'orchestration';
  try {
    const responsePath = path.join(sample.directory, 'response.json');
    let response = await exists(responsePath) ? await read(responsePath) : undefined;
    if (!response) {
      await writeFile(path.join(sample.directory, 'model-started.json'), JSON.stringify({ runId: sample.runId, at: new Date().toISOString(),
        model: plan.model, effort: plan.effort, promptVersion: plan.promptVersion, contextHash: plan.contextHash,
        authorization: 'User requested Pi and OpenCode 3x astra-high each with the approved tree-format rule' }), { flag: 'wx' });
      phase = 'generation'; run.status = 'generating'; Object.assign(run.cells[0], { status: 'generating', startedAt: new Date().toISOString() });
      await runs.save(run); await write(path.join(sample.directory, 'status.json'), { status: 'generating', sample: sample.number, runId: sample.runId });
      response = await runtime.generate({ workflow: 'alternatives', stage: 'alternative', prompt, schema: treeSchema, agentContext: savedContext.snapshot,
        files: {}, model: plan.model, effort: plan.effort, signal: new AbortController().signal });
      await write(responsePath, response); await runtime.flush();
    }
    phase = 'validation';
    const output = treeSchema.parse(response.output), nodes = validateTree(output.ascii);
    await write(path.join(sample.directory, 'validated-output.json'), output);
    await writeFile(path.join(sample.directory, 'diagram.ascii.txt'), output.ascii);
    await write(path.join(sample.directory, 'output-preflight.json'), await preflight(single(output.ascii), project!.id, hash(output.ascii)));
    phase = 'materialization';
    const timeline = new FileCanvasTimeline(config.storeRoot);
    let previous;
    try { previous = await timeline.read(sample.runId); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!previous) {
      const history = materialize(single(output.ascii), sample.runId);
      const ref = { documentId: sample.runId, name: `${plan.repositoryName} core · Astra ${sample.number}`, viewId: history.canvasViews!.activeViewId!, checkpointId: history.headId };
      await timeline.append(sample.runId, project!.id, 0, { id: 'output', phase: 'execution', title: ref.name, commits: [plan.sourceCommit],
        agentContextId: plan.agentContextId, planId: plan.promptId, runId: sample.runId, canvases: [ref] }, { [sample.runId]: history });
    }
    const result = await timeline.result(sample.runId, 'output');
    Object.assign(run.cells[0], { status: 'finished', historyArtifact: { timelineId: sample.runId, stepId: 'output' }, output: summarizeEvalOutput(result),
      usage: response.usage, execution: response.execution, completedAt: new Date().toISOString() });
    run.status = 'finished'; run.completedAt = run.cells[0].completedAt; delete run.error; delete run.cells[0].error; await runs.save(run);
    const status = { status: 'finished', sample: sample.number, runId: sample.runId, characters: output.ascii.length, lines: output.ascii.split('\n').length,
      nodes: nodes.length, usage: response.usage, execution: response.execution,
      outputUrl: `http://localhost:5191/evals?run=${sample.runId}&output=${encodeURIComponent(key)}` };
    await write(path.join(sample.directory, 'status.json'), status); console.log(JSON.stringify(status)); return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run.status = 'failed'; run.error = message; Object.assign(run.cells[0], { status: 'failed', error: message, completedAt: new Date().toISOString() });
    await runs.save(run); await write(path.join(sample.directory, 'status.json'), { status: 'failed', phase, sample: sample.number, runId: sample.runId, error: message });
    throw error;
  } finally { await runtime.flush(); runtime.dispose(); }
}
// Separate sessions and checkouts; no prior sample answers enter another sample's input.
const results = await Promise.allSettled(entries.map(generate));
const summary = { status: results.every(result => result.status === 'fulfilled') ? 'finished' : 'partial', experimentId: plan.experimentId,
  model: plan.model, effort: plan.effort, samples: await Promise.all(entries.map(sample => read(path.join(sample.directory, 'status.json')))) };
await write(path.join(directory, 'status.json'), summary);
console.log(JSON.stringify({ status: summary.status, samples: summary.samples.map(sample => ({ number: sample.sample, status: sample.status, runId: sample.runId })) }));
if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
