// HierGraph spread plan: setup, zero-call preflight, and execution.
//   node --import tsx run.ts              setup + preflight only (no model calls)
//   node --import tsx run.ts --execute    run all five samples
import { readFile, writeFile, appendFile, copyFile, mkdir, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { AgentContextEvalRuntime } from '../../infrastructure/mapping/evals/agentContextEvalRuntime';
import { prepareRepositoryContext } from '../../infrastructure/core/agents/repositoryContext';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { EvalRunService } from '../../application/mapping/evals/evalRunService';
import { evalRunRequestSchema, type EvalRun } from '../../domain/mapping/evals/evalRun';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const read = async (f: string) => JSON.parse(await readFile(f, 'utf8'));
const write = async (f: string, v: unknown) => writeFile(f, JSON.stringify(v, null, 2) + '\n');
const exists = async (f: string) => { try { await access(f); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
const api = async (route: string, body?: unknown) => {
  const r = await fetch('http://127.0.0.1:5191/api/mapping/evals' + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const v = await r.json(); if (!r.ok) throw Error(`${route}: ${r.status} ${JSON.stringify(v)}`); return v;
};

// Same input as E16 P1 for Ghostty: the pinned core tree + checkout context.
const SOURCE_EXPERIMENT = 'd6db3d5a-0042-4bc3-b633-c1ffc3027efd';
const INPUT = { caseId: 'ghostty-core', name: 'Ghostty · core tree', agentContextId: 'saved-agent-context-63f31964-5848-4ed2-b47f-eee31575b626',
  contentHash: 'd450829aa201dbc043b073b7258c26e491a157fb1fa2c8557f101de5840ad07d', commit: 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af' };
const PARENT_PROMPT = { promptId: 'a46e491f-784a-4c4e-9b6e-a85356723da3', version: 1 };
const MODEL = 'gpt-6-astra', EFFORT = 'high', SAMPLES = 5, CONDITION = 'astra-high';

const config = await read(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const runs = new JsonDirectoryStore<EvalRun>(config.storeRoot, 'eval-runs');
const prompt = await readFile(path.join(directory, 'prompt.txt'), 'utf8');
let ids: any;
try { ids = await read(path.join(directory, 'ids.json')); } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  ids = { promptRequestId: randomUUID(), experimentRequestId: randomUUID(), runs: {} };
}
const saveIds = () => write(path.join(directory, 'ids.json'), ids);
await saveIds();

// 1. Input context is exactly the one E16 P1 used.
const saved = await contexts.read(INPUT.agentContextId, false);
assert.equal(saved.contentHash, INPUT.contentHash, 'Ghostty P1 context hash changed');
const source = await api(`/experiments/${SOURCE_EXPERIMENT}`);
const lineage = source.inputLineage.find((l: { caseId: string }) => l.caseId === 'ghostty-p1');
assert.equal(lineage.agentContextId, INPUT.agentContextId);

// 2. Prompt v1, forked from the P1 canvas prompt.
const parent = await api(`/prompts/${PARENT_PROMPT.promptId}`);
const parentVersion = parent.versions.find((v: { version: number }) => v.version === PARENT_PROMPT.version);
const promptRecord = ids.promptId ? await api(`/prompts/${ids.promptId}`) : await api('/prompts', {
  requestId: ids.promptRequestId, workflow: 'alternatives', name: 'HierGraph spread plan',
  description: 'Plan how to spread a dense core component diagram along T (composition) and E (relations): new diagrams, child canvases and same-level canvases. Markdown output.',
  note: `Forked from "${parent.name}" v1: HierGraph formalization, plan instead of canvas, equal vertical and horizontal spread, Markdown output.`,
  templateBase: parentVersion.templateBase, derivation: { parent: PARENT_PROMPT, kind: 'fork' }, stages: { alternative: prompt } });
ids.promptId = promptRecord.id; await saveIds();
const pinned = promptRecord.versions.find((v: { version: number }) => v.version === 1);
assert.equal(pinned.stages.alternative, prompt, 'Saved prompt v1 differs from prompt.txt');
const cellKey = `${ids.promptId}:1:alternative`;

// 3. Five queued runs, owned by this coordinator.
const jobs = Array.from({ length: SAMPLES }, (_, i) => ({ number: i + 1, key: `${CONDITION}/${i + 1}`, dir: path.join(directory, 'jobs', String(i + 1)) }));
for (const j of jobs) {
  ids.runs[j.key] ??= randomUUID(); await saveIds();
  const runId = ids.runs[j.key];
  if (await runs.read(runId)) continue;
  const request = evalRunRequestSchema.parse({ requestId: runId, workflow: 'alternatives', prompts: [{ promptId: ids.promptId, version: 1 }],
    inputs: { context: { agentContextId: INPUT.agentContextId } }, passes: 1, model: MODEL, effort: EFFORT });
  const name = `Ghostty spread plan · ${j.number}`;
  await runs.save({ schemaVersion: 1, id: runId, coordinator: 'canvas-discovery', request, requestHash: hash(JSON.stringify(request)), projectId: source.projectId,
    workflow: 'alternatives', agentContextId: INPUT.agentContextId, contextName: saved.name,
    prompts: [{ ...pinned, promptId: ids.promptId, name: promptRecord.name }], inputs: {},
    contexts: { context: { agentContextId: INPUT.agentContextId, name: saved.name, contentHash: saved.contentHash } },
    name, status: 'queued', createdAt: new Date().toISOString(),
    cells: [{ key: cellKey, promptId: ids.promptId, promptVersion: 1, promptName: promptRecord.name, pass: 1, stage: 'alternative', status: 'queued', candidateName: name }] } as EvalRun);
}

// 4. Experiment record.
const design = {
  name: 'HierGraph spread plan', tags: ['canvas', 'planning', 'hiergraph'],
  description: `Plans for spreading the Ghostty core tree out along T (vertical composition) and E (horizontal relations), using the HierGraph formalization. Same input as ${SOURCE_EXPERIMENT} (E16) P1 for Ghostty; prompt forked from its P1 canvas prompt v1. Output is a Markdown plan of new diagrams, child canvases and same-level canvases. ${SAMPLES} samples, ${MODEL}/${EFFORT}.`,
  phases: [{ id: 'plan', name: 'Spread plan', description: 'Each sample is one independent plan for the same pinned Ghostty core tree.' }],
  workflow: { id: 'spread-plan', name: 'Spread plan', version: 1, stages: [{ id: 'plan', name: 'Spread plan', dependsOn: [] }] },
  cases: [{ id: INPUT.caseId, name: INPUT.name, agentContextId: INPUT.agentContextId, contentHash: INPUT.contentHash }],
  inputLineage: [{ caseId: INPUT.caseId, agentContextId: INPUT.agentContextId, sources: lineage.sources }],
  conditions: [{ id: CONDITION, name: 'Astra/high', description: `${MODEL}/${EFFORT}, HierGraph spread plan prompt v1, read-only checkout at ${INPUT.commit.slice(0, 7)}.` }],
  samples: jobs.map(j => ({ id: ids.runs[j.key], phaseId: 'plan', caseId: INPUT.caseId, conditionId: CONDITION, number: j.number, attempt: 1,
    outputs: [{ stageId: 'plan', runId: ids.runs[j.key], cellKey }] })),
  comparisons: []
};
if (!ids.experimentId) {
  const created = await api('/experiments', { requestId: ids.experimentRequestId, experiment: design });
  ids.experimentId = created.id; await saveIds();
}
await write(path.join(directory, 'plan.json'), { experimentId: ids.experimentId, promptId: ids.promptId, promptSha256: hash(prompt), cellKey, model: MODEL, effort: EFFORT,
  input: INPUT, jobs: jobs.map(j => ({ key: j.key, number: j.number, runId: ids.runs[j.key] })) });

// 5. Zero-call preflight.
class RecordedRuntime extends AgentContextEvalRuntime {
  transcript?: string; events: Promise<unknown> = Promise.resolve();
  constructor(private readonly out: string, private readonly tag: string) { super(root, true); }
  async checkModel() { const c = await this.model(MODEL); return { provider: c.provider, model: c.modelId }; }
  protected async createSession(configuration: Omit<CreateAgentSessionOptions, 'sessionManager'>, context?: AgentContext) {
    const result = await super.createSession(configuration, context);
    this.transcript = result.session.sessionFile;
    await write(path.join(this.out, 'runtime-session.json'), { sessionId: result.session.sessionId, transcript: this.transcript, cwd: configuration.cwd, tools: configuration.tools, contextHash: context?.contentHash, model: MODEL, effort: EFFORT });
    result.session.subscribe(event => {
      if (!['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end', 'message_end'].includes(event.type)) return;
      this.events = this.events.then(() => appendFile(path.join(this.out, 'events.jsonl'), JSON.stringify(event) + '\n'));
      if (event.type === 'tool_execution_start') console.log(JSON.stringify({ job: this.tag, tool: event.toolName }));
    });
    return result;
  }
  async flush() { await this.events; if (this.transcript && await exists(this.transcript)) await copyFile(this.transcript, path.join(this.out, 'transcript.jsonl')); }
}
const markdownOutput = z.string().transform(s => s.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1').trim())
  .refine(s => s.startsWith('# Compression') && s.includes('\n# Canvases') && s.includes('\n# Summary'), 'Plan is missing a required section');
const preflight: Record<string, unknown> = { modelCalls: 0, at: new Date().toISOString() };
{ const r = new RecordedRuntime(directory, 'check'); preflight.model = await r.checkModel(); r.dispose(); }
{
  const prepared = await prepareRepositoryContext(AgentContext.fromSnapshot(saved.snapshot as any));
  try {
    assert.ok(prepared.cwd && prepared.tools.join(',') === 'read,bash', 'Expected an isolated checkout with read,bash');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: prepared.cwd, encoding: 'utf8' }).trim(), INPUT.commit);
    prepared.context.toPiMessages();
    preflight.checkout = { commit: INPUT.commit, tools: prepared.tools };
  } finally { await prepared.close(); }
}
{
  const temporary = await mkdtemp(path.join(tmpdir(), 'spread-plan-preflight-'));
  try {
    const store = new JsonDirectoryStore<any>(temporary, 'eval-runs'), runId = ids.runs[jobs[0].key];
    const fixture = structuredClone(await runs.read(runId))!; fixture.status = 'queued'; fixture.cells[0].status = 'queued'; delete (fixture as any).outputResults; delete fixture.cells[0].output;
    await store.save(fixture);
    const service = () => new EvalRunService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, store, {} as any);
    const markdown = markdownOutput.parse('```markdown\n# Compression\n\n# Canvases\n\n# Summary\nok\n```');
    const first = service(); await first.captureOutputResult(runId, { cellKey, format: 'markdown', markdown }); first.dispose();
    const reopened = service(), loaded: any = await reopened.outputResult(runId, cellKey); reopened.dispose();
    assert.equal(loaded.format, 'markdown'); assert.equal(loaded.markdown, markdown);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
preflight.checks = ['input context hash equals E16 P1 Ghostty case', 'prompt v1 saved and equal to prompt.txt', `${SAMPLES} runs queued and attached`,
  'model resolves', 'checkout at pinned commit with read,bash', 'Markdown capture and reload in disposable storage'];
await write(path.join(directory, 'preflight.json'), preflight);
console.log(JSON.stringify({ preflight: 'passed', experimentId: ids.experimentId, promptId: ids.promptId, model: preflight.model }));
if (!process.argv.includes('--execute')) process.exit(0);

// 6. Execution: one paid call per sample; never re-pay for a started sample.
async function plan(j: typeof jobs[number]) {
  const runId = ids.runs[j.key];
  await mkdir(j.dir, { recursive: true });
  const statusPath = path.join(j.dir, 'status.json'), responsePath = path.join(j.dir, 'response.json');
  if (await exists(statusPath) && (await read(statusPath)).status === 'finished') return read(statusPath);
  if (await exists(path.join(j.dir, 'model-started.json')) && !await exists(responsePath)) throw Error(`${j.key} started without a saved response; refusing another generation`);
  const run = (await runs.read(runId))!, runtime = new RecordedRuntime(j.dir, j.key);
  let phase = 'generation';
  try {
    let response = await exists(responsePath) ? await read(responsePath) : undefined;
    if (!response) {
      await writeFile(path.join(j.dir, 'model-started.json'), JSON.stringify({ runId, at: new Date().toISOString(), model: MODEL, effort: EFFORT, contextHash: saved.contentHash, promptSha256: hash(prompt) }), { flag: 'wx' });
      run.status = 'generating'; Object.assign(run.cells[0], { status: 'generating', startedAt: new Date().toISOString() }); await runs.save(run);
      response = await runtime.generate({ workflow: 'alternatives', stage: 'alternative', prompt, schema: markdownOutput, agentContext: saved.snapshot as any,
        files: {}, model: MODEL, effort: EFFORT, signal: new AbortController().signal });
      await write(responsePath, response); await runtime.flush();
    }
    phase = 'validation';
    const markdown = markdownOutput.parse(typeof response.output === 'string' ? response.output : JSON.stringify(response.output));
    await writeFile(path.join(j.dir, 'plan.md'), markdown + '\n');
    phase = 'save';
    const latest = (await runs.read(runId))!; Object.assign(latest.cells[0], { usage: response.usage, execution: response.execution }); await runs.save(latest);
    await api(`/runs/${runId}/output-result`, { cellKey, format: 'markdown', markdown });
    const status = { status: 'finished', key: j.key, runId, number: j.number, usage: response.usage, outputUrl: `http://localhost:5191/evals?run=${runId}&output=${encodeURIComponent(cellKey)}` };
    await write(statusPath, status); console.log(JSON.stringify({ key: j.key, status: 'finished' })); return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latest = (await runs.read(runId))!; latest.status = 'failed'; latest.error = `${phase}: ${message}`;
    Object.assign(latest.cells[0], { status: 'failed', error: `${phase}: ${message}`, completedAt: new Date().toISOString() }); await runs.save(latest);
    await write(statusPath, { status: 'failed', phase, key: j.key, runId, error: message }); console.log(JSON.stringify({ key: j.key, status: 'failed', phase, error: message.slice(0, 300) }));
    throw error;
  } finally { await runtime.flush(); runtime.dispose(); }
}
const results = await Promise.allSettled(jobs.map(plan));
const failed = results.filter(r => r.status === 'rejected').length;
console.log(JSON.stringify({ done: results.length, failed }));
if (failed) process.exitCode = 1;
