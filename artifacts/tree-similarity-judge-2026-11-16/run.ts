// Tree similarity judge: setup, zero-call preflight, and execution.
//   node --import tsx run.ts              setup + preflight only (no model calls)
//   node --import tsx run.ts --execute --only pilot|all [--concurrency N]
import { readFile, writeFile, appendFile, copyFile, mkdir, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { AgentContextEvalRuntime } from '../../infrastructure/mapping/evals/agentContextEvalRuntime';
import { prepareRepositoryContext } from '../../infrastructure/core/agents/repositoryContext';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { EvalRunService } from '../../application/mapping/evals/evalRunService';
import { evalRunRequestSchema, type EvalRun } from '../../domain/mapping/evals/evalRun';
import { judgeOutputSchema, rescore } from './score';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const read = async (f: string) => JSON.parse(await readFile(f, 'utf8'));
const write = async (f: string, v: unknown) => writeFile(f, JSON.stringify(v, null, 2) + '\n');
const exists = async (f: string) => { try { await access(f); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
const api = async (route: string, body?: unknown) => {
  const r = await fetch('http://127.0.0.1:5191/api/mapping/evals' + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const v = await r.json(); if (!r.ok) throw Error(`${route}: ${r.status} ${JSON.stringify(v)}`); return v;
};
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

const SOURCE_EXPERIMENT = '08ccc7fa-8ea6-4cfa-b0b7-8819b7fcbf35', TREE_CELL = '0b3af2dd-ba89-4032-936a-40070a3e167e:1:alternative';
const repos = {
  ghostty: { name: 'Ghostty', agentContextId: 'saved-agent-context-29fbdd95-72d4-4dc1-ad7c-a1b0f8cd7da6', commit: 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af' },
  mapping: { name: 'Mapping', agentContextId: 'saved-agent-context-2ba25014-3a84-42e9-b5f8-1e10c32fa2cd', commit: '8ca143700ca4d2c870f1101b8cd4601ab68abd41' }
} as const;
const E = path.join(root, 'artifacts/core-component-eval-2026-11-13');
const trees = {
  g1: { label: 'Ghostty S1', repo: 'ghostty', sampleId: '72e2dd01-94e2-45bb-aa00-d3c648356d26', runId: '3d97670a-8d2d-41fe-86c6-7b3914204965', local: `${E}/ghostty-astra-high-v4-03/sample-1/diagram.ascii.txt`, prompt: 4 },
  g2: { label: 'Ghostty S2', repo: 'ghostty', sampleId: '5ea03f0a-7d95-4de4-b3ab-9e28ad909cd7', runId: '87b0635d-e644-43cd-856a-81c73fbc2af6', local: `${E}/ghostty-astra-high-v4-03/sample-2/diagram.ascii.txt`, prompt: 4 },
  g3: { label: 'Ghostty S3', repo: 'ghostty', sampleId: '7aa069f0-5f11-46fc-b839-6988aa6fcc94', runId: 'd8ddfcb7-6be0-4a68-9277-c40a1254248f', local: `${E}/ghostty-astra-high-v4-03/sample-3/diagram.ascii.txt`, prompt: 4 },
  m2: { label: 'Mapping v2', repo: 'mapping', sampleId: '158a261e-afa2-4d05-aaa6-8b348ee66a6e', runId: 'df362edd-3c37-49aa-932d-84181ef9d0c2', local: `${E}/astra-high-8ca1437/diagram.ascii.txt`, prompt: 2 },
  m4a: { label: 'Mapping v4·1', repo: 'mapping', sampleId: 'e3c0f2a7-a8de-4bfa-ac37-0c214cf7ed42', runId: '641693cf-fc8b-43c8-ab5d-bc9b08dd22c7', local: `${E}/mapping-astra-high-v4-02/sample-1/diagram.ascii.txt`, prompt: 4 },
  m4b: { label: 'Mapping v4·2', repo: 'mapping', sampleId: '9a4051bc-9123-424b-a47e-c300ca452210', runId: 'c3aa93d2-4c2a-4e70-846c-61b571c3607d', local: `${E}/mapping-astra-high-v4-02/sample-2/diagram.ascii.txt`, prompt: 4 }
} as const;
type TreeKey = keyof typeof trees;
// Main pairs: repeats 1–2 in A/B order, repeat 3 swapped. Controls: one repeat.
const pairs: Array<{ id: string; A: TreeKey; B: TreeKey; group: string; repo: keyof typeof repos; control?: boolean }> = [
  { id: 'ghostty-1-2', A: 'g1', B: 'g2', group: 'Ghostty v4', repo: 'ghostty' },
  { id: 'ghostty-1-3', A: 'g1', B: 'g3', group: 'Ghostty v4', repo: 'ghostty' },
  { id: 'ghostty-2-3', A: 'g2', B: 'g3', group: 'Ghostty v4', repo: 'ghostty' },
  { id: 'mapping-v4-v4', A: 'm4a', B: 'm4b', group: 'Mapping v4↔v4', repo: 'mapping' },
  { id: 'mapping-v2-v4a', A: 'm2', B: 'm4a', group: 'Mapping v2↔v4', repo: 'mapping' },
  { id: 'mapping-v2-v4b', A: 'm2', B: 'm4b', group: 'Mapping v2↔v4', repo: 'mapping' },
  { id: 'control-self', A: 'g1', B: 'g1', group: 'Control · self', repo: 'ghostty', control: true },
  { id: 'control-cross', A: 'g1', B: 'm4a', group: 'Control · cross-repo', repo: 'ghostty', control: true }
];
const models = [
  { conditionId: 'astra-high-judge', name: 'Astra/high judge', model: 'gpt-6-astra', short: 'Astra' },
  { conditionId: 'sol-high-judge', name: 'Sol/high judge', model: 'gpt-6-sol', short: 'Sol' }
] as const;
const EFFORT = 'high';

const config = await read(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const runs = new JsonDirectoryStore<EvalRun>(config.storeRoot, 'eval-runs');
const prompt = await readFile(path.join(directory, 'judge-prompt.txt'), 'utf8');
let ids: any;
try { ids = await read(path.join(directory, 'ids.json')); } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  ids = { promptRequestId: randomUUID(), experimentRequestId: randomUUID(), contexts: {}, runs: {} };
}
const saveIds = () => write(path.join(directory, 'ids.json'), ids);

// 1. Trees: the API copy must equal the local artifact.
const text: Record<string, string> = {};
for (const [key, tree] of Object.entries(trees)) {
  const result = await api(`/runs/${tree.runId}/output-result?cell=${encodeURIComponent(TREE_CELL)}`);
  const ascii = result.canvases[0].proposed.document.scene.contents[`${tree.runId}-central`].content.ascii;
  assert.equal(ascii, await readFile(tree.local, 'utf8'), `${tree.label} differs from local artifact`);
  text[key] = ascii;
}
const numbered = (s: string) => s.split('\n').map((line, i) => `${String(i + 1).padStart(3)} | ${line}`).join('\n');
const lineCount = (k: TreeKey) => text[k].split('\n').length;

// 2. Prompt v1.
const promptRecord = ids.promptId ? await api(`/prompts/${ids.promptId}`) : await api('/prompts', {
  requestId: ids.promptRequestId, name: 'Judge · Tree similarity', workflow: 'alternatives', stages: { alternative: prompt },
  description: 'Anchor-based recursive similarity between two component trees, with read-only codebase access and a recursive pseudo-Jaccard score.' });
ids.promptId = promptRecord.id; await saveIds();
const pinned = promptRecord.versions.find((v: { version: number }) => v.version === 1);
assert.equal(pinned.stages.alternative, prompt, 'Saved prompt v1 differs from judge-prompt.txt');
const cellKey = `${ids.promptId}:1:alternative`;

// 3. One AgentContext per ordered pair: repository checkout + Tree A + Tree B.
const orderedCases = pairs.flatMap(p => p.control ? [{ ...p, caseId: p.id, swapped: false }]
  : [{ ...p, caseId: p.id, swapped: false }, { ...p, caseId: `${p.id}-swapped`, A: p.B, B: p.A, swapped: true }]);
const caseName = (c: typeof orderedCases[number]) => `${trees[c.A].label} ↔ ${trees[c.B].label}${c.swapped ? ' · swapped' : ''}`;
const repository: Record<string, unknown> = {};
for (const [key, repo] of Object.entries(repos)) {
  const saved = await contexts.read(repo.agentContextId, false), block = saved.snapshot.messages[0].content[0];
  assert.ok(block.type === 'repository' && block.commit === repo.commit, `${repo.name} context is not pinned to ${repo.commit}`);
  // The generation contexts' task asks for a new tree; the judge gets a lookup-only task instead.
  repository[key] = { ...block, task: 'Reference checkout for judging two component trees of this repository. Use it only to decide whether two tree nodes refer to the same code; do not generate a diagram.' };
}
const caseContexts: Record<string, { agentContextId: string; contentHash: string; snapshot: unknown }> = {};
for (const c of orderedCases) {
  ids.contexts[c.caseId] ??= randomUUID(); await saveIds();
  const created = await contexts.create({ requestId: ids.contexts[c.caseId], name: `Similarity · ${caseName(c)}`, group: 'Tree similarity judge',
    description: `${repos[c.repo].name} checkout at ${repos[c.repo].commit.slice(0, 7)} plus two numbered trees from experiment ${SOURCE_EXPERIMENT}: A = ${trees[c.A].label} (sample ${trees[c.A].sampleId}), B = ${trees[c.B].label} (sample ${trees[c.B].sampleId}).`,
    context: [repository[c.repo],
      { type: 'section', name: 'Tree A', content: [{ type: 'text', text: numbered(text[c.A]) }] },
      { type: 'section', name: 'Tree B', content: [{ type: 'text', text: numbered(text[c.B]) }] }] });
  const saved = await contexts.read(created.agentContextId, false);
  caseContexts[c.caseId] = { agentContextId: saved.agentContextId, contentHash: saved.contentHash, snapshot: saved.snapshot };
}

// 4. Jobs: 6 pairs × (2 A/B + 1 swapped) + 2 controls, per judge model = 40.
const experimentProject = (await api(`/experiments/${SOURCE_EXPERIMENT}`)).projectId;
const jobs = models.flatMap(m => orderedCases.flatMap(c => (c.control ? [1] : c.swapped ? [3] : [1, 2]).map(number => ({ m, c, number }))))
  .map(j => ({ ...j, attempt: 1, previous: undefined as string | undefined, key: `${j.m.conditionId}/${j.c.caseId}/${j.number}`, dir: path.join(directory, 'jobs', j.m.conditionId, j.c.caseId, String(j.number)) }));
assert.equal(jobs.length, 40);
// A failed attempt stays recorded; its retry is a new run (attempt 2) that links back to it.
const retries: typeof jobs = [];
for (const j of jobs) {
  const statusFile = path.join(j.dir, 'status.json');
  if (!await exists(statusFile) || (await read(statusFile)).status !== 'failed') continue;
  ids.runs[j.key] ??= randomUUID();
  const key = `${j.key}#2`; ids.runs[key] ??= randomUUID(); await saveIds();
  retries.push({ ...j, key, dir: path.join(j.dir, 'attempt-2'), attempt: 2, previous: ids.runs[j.key] });
}
for (const j of [...jobs, ...retries]) {
  ids.runs[j.key] ??= randomUUID(); await saveIds();
  const runId = ids.runs[j.key], ctx = caseContexts[j.c.caseId];
  if (await runs.read(runId)) continue;
  const request = evalRunRequestSchema.parse({ requestId: runId, workflow: 'alternatives', prompts: [{ promptId: ids.promptId, version: 1 }],
    inputs: { context: { agentContextId: ctx.agentContextId } }, passes: 1, model: j.m.model, effort: EFFORT });
  const name = `${caseName(j.c)} · ${j.m.short} ${j.number}${j.attempt > 1 ? ` · attempt ${j.attempt}` : ''}`;
  await runs.save({ schemaVersion: 1, id: runId, coordinator: 'canvas-discovery', request, requestHash: hash(JSON.stringify(request)), projectId: experimentProject,
    workflow: 'alternatives', agentContextId: ctx.agentContextId, contextName: `Similarity · ${caseName(j.c)}`,
    prompts: [{ ...pinned, promptId: ids.promptId, name: promptRecord.name }], inputs: {},
    contexts: { context: { agentContextId: ctx.agentContextId, name: `Similarity · ${caseName(j.c)}`, contentHash: ctx.contentHash } },
    name, status: 'queued', createdAt: new Date().toISOString(),
    cells: [{ key: cellKey, promptId: ids.promptId, promptVersion: 1, promptName: promptRecord.name, pass: 1, stage: 'alternative', status: 'queued', candidateName: name }] } as EvalRun);
}

// 5. Experiment record.
const design = {
  name: 'Tree similarity judge', tags: ['similarity-judge'],
  description: `Anchor-based recursive similarity judge (prompt v1) applied to saved Phase 2 trees from experiment ${SOURCE_EXPERIMENT}, comparing Astra/high and Sol/high as judges. No diagram regeneration. Each judge has read-only access to the pinned checkout. Main pairs: Ghostty v4 (3), Mapping v4↔v4 (1), Mapping v2↔v4 (2, reported separately as a prompt-effect check); repeats 1–2 in A/B order, repeat 3 swapped. Controls: self (expect ≈1) and cross-repository (expect ≈0). Scores are recomputed deterministically from each judge's anchor JSON.`,
  phases: [{ id: 'judge', name: 'Judge pairs', description: 'Each sample is one independent judge call on one ordered pair of trees.' }],
  workflow: { id: 'tree-similarity', name: 'Tree similarity', version: 1, stages: [{ id: 'judgement', name: 'Similarity judgement', dependsOn: [] }] },
  cases: orderedCases.map(c => ({ id: c.caseId, name: caseName(c), agentContextId: caseContexts[c.caseId].agentContextId, contentHash: caseContexts[c.caseId].contentHash })),
  conditions: models.map(m => ({ id: m.conditionId, name: m.name, description: `${m.model}/${EFFORT} judge, prompt v1, read-only checkout of the pinned repository.` })),
  samples: [...jobs, ...retries].map(j => ({ id: ids.runs[j.key], phaseId: 'judge', caseId: j.c.caseId, conditionId: j.m.conditionId, number: j.number, attempt: j.attempt,
    ...(j.previous ? { relaunchedFrom: { sampleId: j.previous, stageId: 'judgement' } } : {}),
    outputs: [{ stageId: 'judgement', runId: ids.runs[j.key], cellKey }] })),
  comparisons: []
};
if (!ids.experimentId) {
  const saved = await api('/experiments', { requestId: ids.experimentRequestId, experiment: design });
  ids.experimentId = saved.id; await saveIds();
} else {
  const current = await api(`/experiments/${ids.experimentId}`);
  const known = new Set(current.samples.map((s: { id: string }) => s.id)), added = design.samples.filter(s => !known.has(s.id));
  if (added.length) {
    const update = { ...design, tags: current.tags, samples: [...current.samples, ...added] };
    ids.retryRequests ??= {}; const tag = added.map(s => s.id).sort().join(','); ids.retryRequests[tag] ??= randomUUID(); await saveIds();
    await api('/experiments', { requestId: ids.retryRequests[tag], experimentId: ids.experimentId, expectedRevision: current.revision, experiment: update });
    console.log(`Attached ${added.length} retry attempts to the experiment.`);
  }
}
const describe = (j: typeof jobs[number]) => ({ key: j.key, runId: ids.runs[j.key], model: j.m.model, caseId: j.c.caseId, A: trees[j.c.A].label, B: trees[j.c.B].label, number: j.number,
  attempt: j.attempt, ...(j.previous ? { relaunchedFrom: j.previous } : {}), agentContextId: caseContexts[j.c.caseId].agentContextId, contextHash: caseContexts[j.c.caseId].contentHash });
await write(path.join(directory, 'plan.json'), { experimentId: ids.experimentId, promptId: ids.promptId, promptSha256: hash(prompt), cellKey, effort: EFFORT,
  jobs: jobs.map(describe), retries: retries.map(describe) });

// 6. Zero-call preflight: both models resolve, both checkouts open at the pinned commit, Markdown capture survives a reopen.
class RecordedRuntime extends AgentContextEvalRuntime {
  transcript?: string; events: Promise<unknown> = Promise.resolve();
  constructor(private readonly out: string, private readonly tag: string, private readonly modelName: string) { super(root, true); }
  async checkModel() { const c = await this.model(this.modelName); return { provider: c.provider, model: c.modelId }; }
  protected async createSession(configuration: Omit<CreateAgentSessionOptions, 'sessionManager'>, context?: AgentContext) {
    const result = await super.createSession(configuration, context);
    this.transcript = result.session.sessionFile;
    await write(path.join(this.out, 'runtime-session.json'), { sessionId: result.session.sessionId, transcript: this.transcript, cwd: configuration.cwd, tools: configuration.tools, contextHash: context?.contentHash, model: this.modelName, effort: EFFORT });
    result.session.subscribe(event => {
      if (!['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end', 'message_end'].includes(event.type)) return;
      this.events = this.events.then(() => appendFile(path.join(this.out, 'events.jsonl'), JSON.stringify(event) + '\n'));
      if (event.type === 'tool_execution_start') console.log(JSON.stringify({ job: this.tag, tool: event.toolName }));
    });
    return result;
  }
  async flush() { await this.events; if (this.transcript && await exists(this.transcript)) await copyFile(this.transcript, path.join(this.out, 'transcript.jsonl')); }
}
const preflight: Record<string, unknown> = { modelCalls: 0, at: new Date().toISOString(), models: {}, checkouts: {} };
for (const m of models) { const r = new RecordedRuntime(directory, 'check', m.model); (preflight.models as any)[m.model] = await r.checkModel(); r.dispose(); }
for (const [key, repo] of Object.entries(repos)) {
  const sample = orderedCases.find(c => c.repo === key)!;
  const prepared = await prepareRepositoryContext(AgentContext.fromSnapshot(caseContexts[sample.caseId].snapshot as any));
  try {
    assert.ok(prepared.cwd && prepared.tools.join(',') === 'read,bash', 'Expected an isolated checkout with read,bash');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: prepared.cwd, encoding: 'utf8' }).trim(), repo.commit);
    prepared.context.toPiMessages(); // tree sections resolve to model text
    (preflight.checkouts as any)[key] = { commit: repo.commit, tools: prepared.tools };
  } finally { await prepared.close(); }
}
{
  const temporary = await mkdtemp(path.join(tmpdir(), 'similarity-preflight-'));
  try {
    const store = new JsonDirectoryStore<any>(temporary, 'eval-runs'), runId = ids.runs[jobs[0].key];
    const fixture = structuredClone(await runs.read(runId))!; fixture.status = 'queued'; fixture.cells[0].status = 'queued'; delete (fixture as any).outputResults; delete fixture.cells[0].output;
    await store.save(fixture);
    const service = () => new EvalRunService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, store, {} as any);
    const markdown = '# Preflight\n\n- anchor A 1–2 ↔ B 1–2\n';
    const first = service(); await first.captureOutputResult(runId, { cellKey, format: 'markdown', markdown }); first.dispose();
    const reopened = service(), loaded: any = await reopened.outputResult(runId, cellKey); reopened.dispose();
    assert.equal(loaded.format, 'markdown'); assert.equal(loaded.markdown, markdown);
    const sampleOutput = judgeOutputSchema.parse({ score: 1, markdown: 'x', anchors: { J: 1, unmatchedA: [], unmatchedB: [], pairs: [{ label: 'x', a: [[1, 2]], b: [[1, 2]], grouped: false, relocated: false, offset: 0, inner: 'leaves', s: 1 }] } });
    assert.equal(rescore(sampleOutput, { A: 2, B: 2 }).score, 1);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
preflight.checks = ['six tree texts equal local artifacts', 'prompt v1 saved and equal to judge-prompt.txt', '14 pair contexts pinned', '40 runs queued and attached',
  'both judge models resolve', 'both checkouts at pinned commits with read,bash', 'Markdown capture and reload in disposable storage', 'rescore on fixture'];
await write(path.join(directory, 'preflight.json'), preflight);
console.log(JSON.stringify({ preflight: 'passed', experimentId: ids.experimentId, promptId: ids.promptId, jobs: jobs.length, models: preflight.models }));
if (!process.argv.includes('--execute')) process.exit(0);

// 7. Execution.
const only = arg('--only') ?? 'pilot', concurrency = Number(arg('--concurrency') ?? 6);
const pilot = (j: typeof jobs[number]) => j.c.control || (j.c.caseId === 'ghostty-1-2' && j.number === 1);
const latest = jobs.map(j => retries.find(r => r.key === `${j.key}#2`) ?? j);
const selected = latest.filter(j => only === 'all' || pilot(j));
console.log(`Executing ${selected.length} judge calls (${only}), concurrency ${concurrency}.`);
const parseOutput = (raw: unknown) => {
  if (typeof raw !== 'string') return raw;
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/); // deterministic unwrap, no repair call
  return JSON.parse(fenced ? fenced[1] : raw);
};
async function judge(j: typeof jobs[number]) {
  const runId = ids.runs[j.key], ctx = caseContexts[j.c.caseId];
  await mkdir(j.dir, { recursive: true });
  const statusPath = path.join(j.dir, 'status.json');
  if (await exists(statusPath) && (await read(statusPath)).status === 'finished') return read(statusPath);
  const responsePath = path.join(j.dir, 'response.json');
  if (await exists(path.join(j.dir, 'model-started.json')) && !await exists(responsePath)) throw Error(`${j.key} started without a saved response; refusing another generation`);
  const run = (await runs.read(runId))!, runtime = new RecordedRuntime(j.dir, j.key, j.m.model);
  let phase = 'generation';
  try {
    let response = await exists(responsePath) ? await read(responsePath) : undefined;
    if (!response) {
      await writeFile(path.join(j.dir, 'model-started.json'), JSON.stringify({ runId, at: new Date().toISOString(), model: j.m.model, effort: EFFORT, contextHash: ctx.contentHash, promptSha256: hash(prompt) }), { flag: 'wx' });
      run.status = 'generating'; Object.assign(run.cells[0], { status: 'generating', startedAt: new Date().toISOString() }); await runs.save(run);
      response = await runtime.generate({ workflow: 'alternatives', stage: 'alternative', prompt, schema: judgeOutputSchema, agentContext: ctx.snapshot as any,
        files: {}, model: j.m.model, effort: EFFORT, signal: new AbortController().signal });
      await write(responsePath, response); await runtime.flush();
    }
    phase = 'validation';
    const output = judgeOutputSchema.parse(parseOutput(response.output));
    const recomputed = rescore(output, { A: lineCount(j.c.A), B: lineCount(j.c.B) });
    await write(path.join(j.dir, 'judge.json'), output); await write(path.join(j.dir, 'rescore.json'), recomputed);
    await writeFile(path.join(j.dir, 'report.md'), output.markdown + '\n');
    phase = 'save';
    const markdown = `${output.markdown.trim()}\n\n## Anchor tree (JSON)\n\n\`\`\`json\n${JSON.stringify({ score: output.score, anchors: output.anchors }, null, 2)}\n\`\`\`\n`;
    Object.assign(run.cells[0], { usage: response.usage, execution: response.execution }); await runs.save(run);
    await api(`/runs/${runId}/output-result`, { cellKey, format: 'markdown', markdown });
    const status = { status: 'finished', key: j.key, runId, model: j.m.model, caseId: j.c.caseId, number: j.number, reportedScore: output.score, score: recomputed.score,
      rescore: recomputed, usage: response.usage, outputUrl: `http://localhost:5191/evals?run=${runId}&output=${encodeURIComponent(cellKey)}` };
    await write(statusPath, status); console.log(JSON.stringify({ key: j.key, status: 'finished', reported: output.score, recomputed: +recomputed.score.toFixed(3) })); return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latest = (await runs.read(runId))!; latest.status = 'failed'; latest.error = `${phase}: ${message}`;
    Object.assign(latest.cells[0], { status: 'failed', error: `${phase}: ${message}`, completedAt: new Date().toISOString() }); await runs.save(latest);
    await write(statusPath, { status: 'failed', phase, key: j.key, runId, error: message }); console.log(JSON.stringify({ key: j.key, status: 'failed', phase, error: message.slice(0, 300) }));
    throw error;
  } finally { await runtime.flush(); runtime.dispose(); }
}
const queue = [...selected], results: PromiseSettledResult<unknown>[] = [];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
  for (let j = queue.shift(); j; j = queue.shift()) results.push(await judge(j).then(v => ({ status: 'fulfilled', value: v }) as const, e => ({ status: 'rejected', reason: e }) as const));
}));
const failed = results.filter(r => r.status === 'rejected').length;
console.log(JSON.stringify({ done: results.length, failed }));
if (failed) process.exitCode = 1;
