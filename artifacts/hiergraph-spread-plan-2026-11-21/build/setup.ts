// E21 phase 2 · Build canvases from the merged spread plan (linked-canvases workflow).
//   node --import tsx setup.ts prepare   pin the AgentContext and preflight it (zero model calls)
//   node --import tsx setup.ts design    save the prompt and add the build phase with 3 planned runs (zero model calls)
//   node --import tsx setup.ts launch    approve the planned runs; the server runs them
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { prepareRepositoryContext } from '../../../infrastructure/core/agents/repositoryContext';
import { composePrompt, evalWorkflows } from '../../../domain/mapping/evals/evalWorkflows';
import { defaultPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';
import { materializeLinkedCanvases } from '../../../application/mapping/evals/linkedCanvasesMaterializer';
import { linkedCanvasesOutputSchema } from '../../../domain/mapping/evals/linkedCanvases';

const mode = process.argv[2]; assert(['prepare', 'design', 'launch'].includes(mode));
const d = import.meta.dirname, root = path.resolve(d, '../../..'), storage = path.join(root, '.diagrams-local/canvas-domain-model');
const API = 'http://127.0.0.1:5191/api/mapping/evals';
const read = async (f: string) => JSON.parse(await readFile(f, 'utf8'));
const write = (f: string, x: unknown) => writeFile(f, JSON.stringify(x, null, 2) + '\n');
const exists = (f: string) => access(f).then(() => true, () => false);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
async function api(route: string, body?: unknown) {
  const r = await fetch(API + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw Error(`${route} ${r.status} ${JSON.stringify(j)}`); return j;
}

const idsFile = path.join(d, 'ids.json');
if (!await exists(idsFile)) await write(idsFile, { context: randomUUID(), prompt: randomUUID(), design: randomUUID(), approval: randomUUID(), runs: [randomUUID(), randomUUID(), randomUUID()] });
const ids = await read(idsFile);
const phase1 = await read(path.join(d, '../ids.json'));
const EXPERIMENT = phase1.experimentId, PHASE1_CELL = `${phase1.promptId}:1:alternative`;
const P1_CONTEXT = 'saved-agent-context-63f31964-5848-4ed2-b47f-eee31575b626', COMMIT = 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af';
const MODEL = 'gpt-6-astra', EFFORT = 'high', CANVASES = ['session', 'interaction', 'io', 'emulator', 'presentation', 'search', 'host'];
const promptText = await readFile(path.join(d, 'prompt.txt'), 'utf8');
const planText = await readFile(path.join(d, '../merge/plan.md'), 'utf8');
const library = new AgentContextLibrary(new FileAgentContextRepository(storage));

/** Probe output with the plan's seven canvases, intra-canvas edges and cross-canvas jumps. */
function probeOutput() {
  const tree = (t: string) => `${t}\n|-- part A\n|   \`-- -> io/transport IO mailbox: probe\n\`-- part B`;
  return { explanation: 'probe', rootCanvas: 'session',
    canvases: CANVASES.map(c => ({ kind: 'new' as const, id: c, name: c,
      diagrams: [{ id: 'd1', ascii: tree(`${c} one`), position: { column: 0, row: 0 } }, { id: 'd2', ascii: tree(`${c} two`), position: { column: 60, row: 0 } }],
      edges: [{ source: { diagram: 'd1', line: 2 }, target: { diagram: 'd2', line: 4 }, label: 'T: probe' }] })),
    jumps: CANVASES.slice(1).map((c, i) => ({ source: { canvas: 'session', diagram: i < 3 ? 'd1' : 'd2', line: (i % 3) + 1, startColumn: 1, endColumn: 3 },
      target: { canvas: c, diagram: 'd1', line: 1 } })) };
}

if (mode === 'prepare') {
  const p1 = await library.read(P1_CONTEXT, false);
  const [coreBlock, repo] = p1.snapshot.messages[0].content as any[];
  assert.equal(coreBlock.type, 'text'); assert(coreBlock.text.startsWith('<core-component-diagram'));
  assert.equal(repo.type, 'repository'); assert.equal(repo.commit, COMMIT);
  const task = 'Use this checkout to fill the diagrams the spread plan specifies with accurate content. Verify the composition and relations you draw, and correct anything the source contradicts.';
  const receipt = await library.create({ requestId: ids.context, group: 'HierGraph spread plan', name: 'Ghostty · merged spread plan · build',
    description: `Build input for E21 phase 2. Same core tree and checkout as E16 P1 Ghostty (${P1_CONTEXT}), plus the merged spread plan: an in-session synthesis by Claude Opus 5.5 of the five E21 phase 1 plans (runs ${Object.values(phase1.runs).join(', ')}). The merge is not a model generation of this experiment. Plan sha256 ${sha(planText)}.`,
    context: [coreBlock,
      { type: 'text', text: `<spread-plan repository="Ghostty" commit="${COMMIT}">\n${planText}\n</spread-plan>` },
      { ...repo, task }] });
  const saved = await library.read(receipt.agentContextId, false); assert.equal(saved.contentHash, receipt.contentHash);
  const checkout = await prepareRepositoryContext(AgentContext.fromSnapshot(saved.snapshot));
  try {
    assert.deepEqual(checkout.tools, ['read', 'bash']);
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout.cwd, encoding: 'utf8' }).trim(), COMMIT);
    checkout.context.toPiMessages();
  } finally { await checkout.close(); }
  const composed = composePrompt(evalWorkflows['linked-canvases' as keyof typeof evalWorkflows] as any, 'linked', promptText, {}, defaultPromptTemplateBase);
  for (const tag of ['agent context', 'task', 'output format']) assert(composed.includes(`<${tag}>`), 'missing section ' + tag);
  assert(composed.includes('HierGraph = (V, T, E)') && composed.includes('1-based raw ASCII line numbers'));
  const probe = linkedCanvasesOutputSchema.parse(probeOutput());
  const { result } = materializeLinkedCanvases(probe, [], 'probe');
  assert.equal(result.canvases.length, CANVASES.length);
  assert.equal(result.canvases[0].proposed.document.edges.length, 1);
  await write(path.join(d, 'context.json'), { ...receipt, planSha256: sha(planText), sources: Object.entries(phase1.runs).map(([key, runId]) => ({
    label: `Spread plan · sample ${key.split('/')[1]}`, experimentId: EXPERIMENT, runId, cellKey: PHASE1_CELL })) });
  console.log(`Pinned ${receipt.agentContextId}; checkout at ${COMMIT.slice(0, 7)}, prompt composition and 7-canvas materialization verified; zero model calls.`);
}

if (mode === 'design') {
  const ctx = await read(path.join(d, 'context.json'));
  if (!await exists(path.join(d, 'prompt-receipt.json'))) {
    const p = await api('/prompts', { requestId: ids.prompt, workflow: 'linked-canvases', name: 'Build canvases from spread plan',
      description: 'One agent builds every canvas, diagram and link a spread plan specifies, with checkout access, using the HierGraph mapping onto linked canvases.',
      templateBase: defaultPromptTemplateBase, stages: { linked: promptText } });
    assert.equal(p.versions[0].stages.linked, promptText);
    await write(path.join(d, 'prompt-receipt.json'), { promptId: p.id, version: 1, contentHash: p.versions[0].contentHash });
  }
  const prompt = await read(path.join(d, 'prompt-receipt.json'));
  const cellKey = `${prompt.promptId}:1:linked`;
  const current = await api(`/experiments/${EXPERIMENT}`);
  assert(!current.phases.some((p: { id: string }) => p.id === 'build'), 'Build phase already added');
  const samples = ids.runs.map((_: string, i: number) => ({ id: `ghostty-build-${i + 1}`, phaseId: 'build', caseId: 'ghostty-build', conditionId: 'single-agent', number: i + 1, attempt: 1, outputs: [] }));
  const design = {
    name: current.name, tags: current.tags,
    description: `${current.description} Phase 2 builds the canvases from one merged plan: a single Astra/high agent with checkout access, 3 samples.`,
    phases: [...current.phases, { id: 'build', name: 'Build canvases', description: 'Variant 1 · single agent. One agent receives the merged spread plan, the core tree and the Ghostty checkout, and builds every canvas, diagram and link in the plan as one linked canvas set. The merged plan is an in-session Claude Opus 5.5 synthesis of the five phase 1 plans, not a model generation of this experiment.' }],
    workflow: { ...current.workflow, version: current.workflow.version + 1, stages: [...current.workflow.stages, { id: 'build', name: 'Build canvases', dependsOn: ['plan'] }] },
    cases: [...current.cases, { id: 'ghostty-build', name: 'Ghostty · merged plan', agentContextId: ctx.agentContextId, contentHash: ctx.contentHash }],
    inputLineage: [...(current.inputLineage ?? []), { caseId: 'ghostty-build', agentContextId: ctx.agentContextId, sources: ctx.sources }],
    conditions: [...current.conditions, { id: 'single-agent', name: 'Single agent', description: `Variant 1: one ${MODEL}/${EFFORT} agent builds all 7 planned canvases with read-only checkout access (linked-canvases workflow, prompt v1).` }],
    samples: [...current.samples, ...samples],
    plannedRuns: [...(current.plannedRuns ?? []), ...ids.runs.map((runId: string, i: number) => ({
      request: { requestId: runId, workflow: 'linked-canvases', prompts: [{ promptId: prompt.promptId, version: 1 }],
        inputs: { context: { agentContextId: ctx.agentContextId } }, passes: 1, model: MODEL, effort: EFFORT },
      outputs: [{ sampleId: samples[i].id, stageId: 'build', cellKey }] }))],
    comparisons: current.comparisons
  };
  const r = await api('/experiments', { requestId: ids.design, experimentId: EXPERIMENT, expectedRevision: current.revision, experiment: design });
  await write(path.join(d, 'plan.json'), { experimentId: r.id, revision: r.revision, review: r.generationReview?.status, runs: r.generationReview?.runs?.map((x: { id: string }) => x.id) });
  console.log(`Experiment ${r.id} rev ${r.revision}: ${r.generationReview?.status}, ${r.generationReview?.runs?.length} run(s) awaiting launch; zero model calls.`);
}

if (mode === 'launch') {
  const plan = await read(path.join(d, 'plan.json'));
  const r = await api(`/experiments/${plan.experimentId}/approve`, { requestId: ids.approval, expectedRevision: plan.revision });
  assert.equal(r.generationReview.status, 'started');
  console.log(`Approved ${plan.experimentId}; ${ids.runs.length} runs launched (${MODEL}/${EFFORT}).`);
}
