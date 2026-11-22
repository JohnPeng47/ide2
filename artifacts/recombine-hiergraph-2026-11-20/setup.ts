// Recombine 3+1 trees into one Hierarchical Graph (linked-canvases workflow).
// prepare: pin the AgentContext and preflight it (zero model calls)
// design:  register the prompt and the experiment with one planned run (zero model calls)
// launch:  approve the plan; the server runs the single generation
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileCanvasTimeline } from '../../infrastructure/mapping/history/fileCanvasTimeline';
import { prepareRepositoryContext } from '../../infrastructure/core/agents/repositoryContext';
import { documentFromHistory } from '../../domain/core/diagrams/canvasHistory';
import { composePrompt, evalWorkflows } from '../../domain/mapping/evals/evalWorkflows';
import { defaultPromptTemplateBase } from '../../domain/mapping/evals/promptTemplateBase';
import { materializeLinkedCanvases } from '../../application/mapping/evals/linkedCanvasesMaterializer';
import { linkedCanvasesOutputSchema } from '../../domain/mapping/evals/linkedCanvases';

const mode = process.argv[2]; assert(['prepare', 'design', 'launch'].includes(mode));
const d = import.meta.dirname, root = path.resolve(d, '../..'), storage = path.join(root, '.diagrams-local/canvas-domain-model');
const API = 'http://127.0.0.1:5191/api/mapping/evals';
const read = async (f: string) => JSON.parse(await readFile(f, 'utf8'));
const write = (f: string, x: unknown) => writeFile(f, JSON.stringify(x, null, 2) + '\n');
const exists = (f: string) => access(f).then(() => true, () => false);
const log = (m: string) => console.log(new Date().toISOString(), m);
async function api(route: string, body?: unknown) {
  const r = await fetch(API + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw Error(`${route} ${r.status} ${JSON.stringify(j)}`); return j;
}

const ids = await read(path.join(d, 'ids.json'));
const SRC = path.join(root, 'artifacts/3plus1-core-component-2026-11-19');
const coreIds = await read(path.join(SRC, 'ids.json')), names = await read(path.join(SRC, 'expand/names.json'));
const SOURCE_EXPERIMENT = coreIds.experiment; // E18 · 3+1 Model Core Component
const REPO_CONTEXT = 'saved-agent-context-29fbdd95-72d4-4dc1-ad7c-a1b0f8cd7da6', COMMIT = 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af';
const keys = ['modular', 'call', 'ownership', 'data'] as const;
const MODEL = 'gpt-6-astra', EFFORT = 'high';
const promptText = await readFile(path.join(d, 'prompt.txt'), 'utf8');
const runs = new JsonDirectoryStore<any>(storage, 'eval-runs');
const library = new AgentContextLibrary(new FileAgentContextRepository(storage));
const timeline = new FileCanvasTimeline(storage);

/** A small output that exercises every mapping the prompt asks for: 3 canvases, edges, jumps. */
function probeOutput() {
  const tree = (t: string) => `${t}\n|-- cluster A\n|   \`-- leaf src/App.zig:1-10\n\`-- cluster B`;
  const canvas = (c: string) => ({ kind: 'new' as const, id: c, name: `Probe ${c}`,
    diagrams: [{ id: 'd1', ascii: tree(`${c} one`), position: { column: 0, row: 0 } }, { id: 'd2', ascii: tree(`${c} two`), position: { column: 60, row: 0 } }],
    edges: [{ source: { diagram: 'd1', line: 2 }, target: { diagram: 'd2', line: 4 }, label: 'calls: probe' }] });
  return { explanation: 'probe', rootCanvas: 'c1', canvases: [canvas('c1'), canvas('c2'), canvas('c3')],
    jumps: [{ source: { canvas: 'c1', diagram: 'd1', line: 2, startColumn: 5, endColumn: 13 }, target: { canvas: 'c2', diagram: 'd1', line: 2 } },
      { source: { canvas: 'c2', diagram: 'd2', line: 4, startColumn: 5, endColumn: 13 }, target: { canvas: 'c3', diagram: 'd1', line: 1 } }] };
}

if (mode === 'prepare') {
  const trees = [], sources = [];
  for (const key of keys) {
    const runId = coreIds.runs[`${key}-examples`], run = await runs.read(runId);
    assert.equal(run.status, 'finished');
    const ref = (await timeline.read(runId)).steps[0].canvases[0];
    const doc = documentFromHistory(await timeline.editingHistory(runId, ref));
    assert.equal(doc.scene.root.children.length, 1);
    const box = doc.scene.root.children[0]; assert.equal(box.kind, 'diagram');
    const ascii = doc.scene.contents[(box as any).contentId].content.ascii;
    assert.equal(ascii, await readFile(path.join(SRC, `runs/${key}-examples-1/diagram.ascii.txt`), 'utf8'));
    trees.push({ id: `${key}-tree`, lens: names[key], sourceRun: runId, ascii });
    sources.push({ experimentId: SOURCE_EXPERIMENT, runId, cellKey: run.cells[0].key, checkpointId: ref.checkpointId, label: `Ghostty · ${names[key]} · core tree` });
  }
  const parent = await library.read(REPO_CONTEXT, false);
  const repo = parent.snapshot.messages[0].content.find((b: any) => b.type === 'repository')!; assert.equal(repo.commit, COMMIT);
  const task = 'Use this checkout to check intersections between the supplied trees and the facts you place in the Hierarchical Graph, and correct anything the source contradicts.';
  const receipt = await library.create({ requestId: ids.context, group: 'Recombine 3+1 trees', name: 'Ghostty · 3+1 trees · recombine',
    description: `Sample 1 (existing few-shot examples) of each 3+1 view's core tree from experiment ${SOURCE_EXPERIMENT}: ${sources.map(s => s.runId).join(', ')}.`,
    context: [{ type: 'text', text: `<decomposition-trees repository="Ghostty" commit="${COMMIT}">\n${JSON.stringify(trees, null, 2)}\n</decomposition-trees>` }, { ...repo, task }] });
  const saved = await library.read(receipt.agentContextId, false); assert.equal(saved.contentHash, receipt.contentHash);
  // Restore exactly as the server runtime does: isolated checkout at the pinned commit.
  const checkout = await prepareRepositoryContext(AgentContext.fromSnapshot(saved.snapshot));
  try {
    assert.deepEqual(checkout.tools, ['read', 'bash']);
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout.cwd, encoding: 'utf8' }).trim(), COMMIT);
    checkout.context.toPiMessages();
  } finally { await checkout.close(); }
  // Prompt composition must reproduce the pinned text verbatim (no template substitution surprises).
  const composed = composePrompt(evalWorkflows['linked-canvases' as keyof typeof evalWorkflows] as any, 'linked', promptText, {}, defaultPromptTemplateBase);
  for (const tag of ['agent context', 'task', 'output format']) assert(composed.includes(`<${tag}>`), 'missing section ' + tag);
  assert(composed.includes('~6 intra-canvas edges') && composed.includes('~3 inter-canvas edges'));
  // Deterministic materialization of the same output shape the prompt requests.
  const probe = linkedCanvasesOutputSchema.parse(probeOutput());
  const { result } = materializeLinkedCanvases(probe, [], 'probe');
  assert.equal(result.canvases.length, 3); assert(result.placementSnapshot);
  assert.equal(result.canvases[0].proposed.document.edges.length, 1);
  await write(path.join(d, 'context.json'), { ...receipt, trees: trees.map(t => ({ id: t.id, lines: t.ascii.split('\n').length })), sources });
  log(`Pinned ${receipt.agentContextId} (${trees.map(t => t.id).join(', ')}); checkout, composition and materialization verified; zero model calls.`);
}

if (mode === 'design') {
  const ctx = await read(path.join(d, 'context.json'));
  if (!await exists(path.join(d, 'prompt-receipt.json'))) {
    const p = await api('/prompts', { requestId: ids.prompt, workflow: 'linked-canvases', name: 'Recombine 3+1 trees · HierGraph',
      description: 'Weave four 3+1 decomposition trees into a 3-canvas Hierarchical Graph using formal intersections.',
      templateBase: defaultPromptTemplateBase, stages: { linked: promptText } });
    assert.equal(p.versions[0].stages.linked, promptText);
    await write(path.join(d, 'prompt-receipt.json'), { promptId: p.id, version: 1, contentHash: p.versions[0].contentHash });
  }
  const prompt = await read(path.join(d, 'prompt-receipt.json'));
  const cellKey = `${prompt.promptId}:1:linked`;
  const design = {
    name: 'Recombine 3+1 trees', tags: ['3+1', 'ghostty', 'hiergraph'],
    description: 'Recombine the four Ghostty 3+1 core trees (sample 1 with examples from E18) into one Hierarchical Graph: 3 canvases of 3–4 diagrams, ~6 intra-canvas edges and ~3 inter-canvas jumps per canvas, structured around formally defined intersections.',
    workflow: { id: 'linked-canvases', name: 'Linked canvases', version: 1, stages: [{ id: 'linked', name: 'Linked canvas set', dependsOn: [] }] },
    phases: [{ id: 'recombine', name: 'Recombine into HierGraph', description: 'One linked canvas set from the four view-specific core trees, with the pinned Ghostty checkout for verification. No lens is the default backbone.' }],
    cases: [{ id: 'ghostty-3plus1', name: 'Ghostty · four 3+1 core trees', agentContextId: ctx.agentContextId, contentHash: ctx.contentHash }],
    inputLineage: [{ caseId: 'ghostty-3plus1', agentContextId: ctx.agentContextId, sources: ctx.sources }],
    conditions: [{ id: 'recombine-v1', name: 'Recombine v1', description: 'Intersections (I1 two or more lenses, I2 semantic identity), open-ended structure, target dimensions K=3, D=3–4, N≈6, M≈3.' }],
    samples: [{ id: 'ghostty-3plus1-1', phaseId: 'recombine', caseId: 'ghostty-3plus1', conditionId: 'recombine-v1', number: 1, attempt: 1, outputs: [] }],
    plannedRuns: [{ request: { requestId: ids.run, workflow: 'linked-canvases', prompts: [{ promptId: prompt.promptId, version: 1 }],
      inputs: { context: { agentContextId: ctx.agentContextId } }, passes: 1, model: MODEL, effort: EFFORT },
      outputs: [{ sampleId: 'ghostty-3plus1-1', stageId: 'linked', cellKey }] }],
    comparisons: []
  };
  const r = await api('/experiments', { requestId: ids.experiment, experiment: design });
  await write(path.join(d, 'plan.json'), { experimentId: r.id, revision: r.revision, review: r.generationReview?.status });
  log(`Experiment ${r.id} rev ${r.revision}: ${r.generationReview?.status}, ${r.generationReview?.runs?.length} run(s); zero model calls.`);
}

if (mode === 'launch') {
  const plan = await read(path.join(d, 'plan.json'));
  const r = await api(`/experiments/${plan.experimentId}/approve`, { requestId: ids.approval, expectedRevision: plan.revision });
  assert.equal(r.generationReview.status, 'started');
  log(`Approved ${plan.experimentId}; run ${ids.run} launched (${MODEL}/${EFFORT}, n=1).`);
}
