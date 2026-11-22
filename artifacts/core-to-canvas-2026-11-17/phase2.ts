// Phase 1 extension (2 more samples per repo, prompt v1) + Phase 2 (expand each original Phase 1
// canvas 3x, prompt v2). Preflight runs with zero model calls; --approve launches all generations.
// Idempotent: request IDs persist in phase2-ids.json.
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { prepareRepositoryContext } from '../../infrastructure/core/agents/repositoryContext';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { renderPromptSections } from '../../domain/mapping/evals/promptTemplateBase';
import { materializeAlternative } from '../../application/mapping/evals/alternativeMaterializer';
import type { EvalRun } from '../../domain/mapping/evals/evalRun';
import type { GridBox } from '../../domain/core/diagrams/lineGrid';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const storeRoot = path.join(root, '.diagrams-local/canvas-domain-model');
const read = async (f: string) => JSON.parse(await readFile(path.join(directory, f), 'utf8'));
const write = (f: string, v: unknown) => writeFile(path.join(directory, f), JSON.stringify(v, null, 2) + '\n');
const exists = async (f: string) => { try { await access(path.join(directory, f)); return true; } catch { return false; } };
const api = async (route: string, body?: unknown) => {
  const r = await fetch('http://127.0.0.1:5191/api/mapping/evals' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw Error(`${route}: ${r.status} ${JSON.stringify(j)}`); return j;
};

const experimentId = '7821c7da-cfcd-446d-8d7f-43b26df049fe';
const seeds: any[] = (await read('contexts-receipt.json')).map((s: any) => ({ ...s, name: s.name.split(' · ')[0] }));
const firstIds = await read('experiment-ids.json');
const promptId = (await read('prompt-receipt.json')).id;
const ids = await exists('phase2-ids.json') ? await read('phase2-ids.json') : {
  promptRequestId: randomUUID(), experimentRequestId: randomUUID(), approveRequestId: randomUUID(),
  contexts: Object.fromEntries(seeds.map(s => [s.key, randomUUID()])),
  phase1Runs: Object.fromEntries(seeds.map(s => [s.key, randomUUID()])),
  phase2Runs: Object.fromEntries(seeds.map(s => [s.key, randomUUID()])),
};
await write('phase2-ids.json', ids);

// --- 1. Each original Phase 1 canvas, in exactly the prompt's output shape (IDs without the materializer's alt- prefix).
const runs = new JsonDirectoryStore<EvalRun>(storeRoot, 'eval-runs');
const canvases: Record<string, any> = {};
for (const s of seeds) {
  const run = (await runs.read(firstIds.runs[s.key]))!, cell = run.cells[0];
  if (cell.status !== 'finished' || !cell.canvasId || !cell.checkpointId) throw Error(`${s.name}: Phase 1 output unavailable`);
  const history = run.outputSnapshots![cell.canvasId].history, snapshot = history.snapshots[cell.checkpointId];
  const strip = (id: string) => id.replace(/^(grid:)?alt-/, '');
  const diagrams: any[] = [], lineOf = new Map<string, number>();
  const walk = (box: GridBox) => {
    if (box.kind === 'container') return box.children.forEach(walk);
    const revision = history.diagramRevisions[snapshot.diagramBindings[box.contentId]];
    diagrams.push({ id: strip(box.id), ascii: revision.diagram.content.ascii, position: { column: box.position.column, row: box.position.row } });
    for (const [ref, nodeId] of Object.entries(revision.nodeRefs ?? {})) {
      const m = ref.match(/:node-(\d+)-\d+$/); if (m) lineOf.set(`${box.id}|${nodeId}`, Number(m[1]));
    }
  };
  walk(snapshot.document.scene.root);
  const endpoint = (e: any) => {
    const box = e.displayNodeId.replace(/^grid:/, ''), line = lineOf.get(`${box}|${e.contentNodeId}`);
    if (e.kind !== 'content-node' || !line) throw Error(`${s.name}: cannot resolve edge endpoint ${JSON.stringify(e)}`);
    return { diagram: strip(box), line };
  };
  const edges = snapshot.document.edges.map((e: any) => ({ source: endpoint(e.source), target: endpoint(e.target), ...(e.appearance?.label ? { label: e.appearance.label } : {}) }));
  canvases[s.key] = { source: { runId: run.id, cellKey: cell.key, canvasId: cell.canvasId, checkpointId: cell.checkpointId }, diagrams, edges };
  // Round trip: the input must be a valid output and materialize to the same diagrams.
  const replay = materializeAlternative({ explanation: 'preflight', diagrams, edges });
  if (Object.keys(replay.history.snapshots[replay.history.headId].document.edges).length !== edges.length) throw Error(`${s.name}: edge round trip failed`);
}
await write('phase2-canvases.json', canvases);

// --- 2. Phase 2 AgentContexts: the canvas (JSON) + the same pinned checkout.
const library = new AgentContextLibrary(new FileAgentContextRepository(storeRoot));
const TASK = 'Use this checkout to double-check the supplied canvas while restructuring it. Verify the containment, ownership and relationships you rely on, and correct anything the source contradicts.';
const contexts: any[] = [];
for (const s of seeds) {
  const seed = await library.read(s.agentContextId, false);
  const repo = (seed.snapshot.messages[0].content as any[]).find(b => b.type === 'repository');
  const { source, ...canvas } = canvases[s.key];
  const text = `<current-canvas repository="${s.name}" commit="${repo.commit}">\n${JSON.stringify(canvas, null, 2)}\n</current-canvas>`;
  const receipt = await library.create({ requestId: ids.contexts[s.key], group: 'Core component → canvas', name: `${s.name} · canvas → expanded canvas`,
    description: `Phase 1 canvas from run ${source.runId} (checkpoint ${source.checkpointId}) in the prompt's output format, plus the pinned checkout at ${repo.commit}.`,
    context: [{ type: 'text', text }, { ...repo, task: TASK }] });
  contexts.push({ ...s, ...receipt, source });
}
await write('phase2-contexts-receipt.json', contexts);

// --- 3. Prompt v2.
const v2 = await readFile(path.join(directory, 'prompt-v2.txt'), 'utf8');
let prompt = await api(`/prompts/${promptId}`);
if (!prompt.versions.some((v: any) => v.stages.alternative === v2)) {
  const latest = prompt.versions.at(-1);
  prompt = await api('/prompts', { requestId: ids.promptRequestId, promptId, baseVersion: latest.version, workflow: 'alternatives', name: prompt.name,
    note: 'Recursive form: input is a whole canvas; model chooses diagrams to expand (soft preference for vertical expansion) and returns the complete canvas in place.',
    templateBase: latest.templateBase, stages: { alternative: v2 } });
}
const v2Version = prompt.versions.find((v: any) => v.stages.alternative === v2).version;
renderPromptSections(v2, prompt.versions.at(-1).templateBase);
await write('prompt-v2-receipt.json', { promptId, version: v2Version, contentHash: prompt.versions.find((v: any) => v.version === v2Version).contentHash });

// --- 4. Preflight checkouts for the Phase 2 contexts.
for (const c of contexts) {
  const saved = await library.read(c.agentContextId, false), checkout = await prepareRepositoryContext(AgentContext.fromSnapshot(saved.snapshot));
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout.cwd!, encoding: 'utf8' }).trim();
    if (head !== c.commit || checkout.tools.join(',') !== 'read,bash') throw Error(`${c.name}: checkout mismatch`);
    await writeFile(path.join(directory, `rendered-phase2-context-${c.key}.json`), JSON.stringify(checkout.context.toPiMessages(), null, 2));
  } finally { await checkout.close(); }
}
console.log('Preflight passed (zero model calls):', contexts.map(c => `${c.name} ${canvases[c.key].diagrams.length} diagrams/${canvases[c.key].edges.length} edges`).join('; '));

// --- 5. Experiment update: label Phase 1, extend it, add Phase 2.
const current = await api(`/experiments/${experimentId}`);
// Phase 1 as originally approved; everything else is rebuilt so reruns are idempotent.
const originalRuns = new Set(Object.values(firstIds.runs)), originalKeys = new Set(seeds.map(s => s.key));
const base = { cases: current.cases.filter((c: any) => originalKeys.has(c.id)), conditions: current.conditions.filter((c: any) => c.id === 'vertical-framing'),
  samples: current.samples.filter((s: any) => originalKeys.has(s.id)), plannedRuns: current.plannedRuns.filter((p: any) => originalRuns.has(p.request.requestId)),
  workflow: { ...current.workflow, stages: current.workflow.stages.filter((s: any) => s.id === 'split') } };
const v1 = { promptId, version: 1 };
const design = {
  name: current.name, description: current.description, tags: current.tags,
  workflow: { ...base.workflow, stages: [base.workflow.stages[0], { id: 'expand', name: 'Expand canvas', dependsOn: ['split'] }] },
  phases: [
    { id: 'canvas', name: 'Phase 1 · Core diagram → canvas', description: 'Restructure each core component diagram into a central diagram with peripherals (prompt v1). Three samples per repository.' },
    { id: 'expand', name: 'Phase 2 · Expand canvas', description: 'Apply the recursive prompt (v2) to each repository\'s first Phase 1 canvas; the model chooses which diagrams to expand. Three samples per input canvas.' },
  ],
  cases: [...base.cases, ...contexts.map(c => ({ id: `${c.key}-canvas`, name: `${c.name.split(" · ")[0]} · Phase 1 canvas`, agentContextId: c.agentContextId, contentHash: c.contentHash }))],
  conditions: [...base.conditions, { id: 'recursive', name: 'Recursive expansion', description: 'Prompt v2: whole canvas in, complete canvas out; soft preference for expanding along the vertical dimension.' }],
  samples: [
    ...base.samples.map((s: any) => ({ ...s, phaseId: 'canvas' })),
    ...seeds.flatMap(s => [2, 3].map(n => ({ id: `${s.key}-${n}`, caseId: s.key, conditionId: 'vertical-framing', number: n, attempt: 1, outputs: [], phaseId: 'canvas' }))),
    ...seeds.flatMap(s => [1, 2, 3].map(n => ({ id: `${s.key}-expand-${n}`, caseId: `${s.key}-canvas`, conditionId: 'recursive', number: n, attempt: 1, outputs: [], phaseId: 'expand' }))),
  ],
  comparisons: current.comparisons,
  plannedRuns: [
    ...base.plannedRuns,
    ...seeds.map(s => ({ request: { requestId: ids.phase1Runs[s.key], workflow: 'alternatives', prompts: [v1], inputs: { context: { agentContextId: s.agentContextId } }, passes: 2, model: 'gpt-6-astra', effort: 'high' },
      outputs: [2, 3].map((n, i) => ({ sampleId: `${s.key}-${n}`, stageId: 'split', cellKey: `${promptId}:${i + 1}:alternative` })) })),
    ...contexts.map(c => ({ request: { requestId: ids.phase2Runs[c.key], workflow: 'alternatives', prompts: [{ promptId, version: v2Version }], inputs: { context: { agentContextId: c.agentContextId } }, passes: 3, model: 'gpt-6-astra', effort: 'high' },
      outputs: [1, 2, 3].map(n => ({ sampleId: `${c.key}-expand-${n}`, stageId: 'expand', cellKey: `${promptId}:${n}:alternative` })) })),
  ],
};
let experiment = current;
const same = JSON.stringify(current.cases) === JSON.stringify(design.cases) && JSON.stringify(current.plannedRuns) === JSON.stringify(design.plannedRuns);
if (!same) {
  const update = { requestId: current.phases?.length ? randomUUID() : ids.experimentRequestId, experimentId, expectedRevision: current.revision, experiment: design };
  await write('phase2-experiment-request.json', update);
  experiment = await api('/experiments', update);
}
await write('phase2-experiment-receipt.json', experiment);
console.log('Experiment revision', experiment.revision, 'review', experiment.generationReview?.status, 'pending runs', experiment.generationReview?.runs?.length);

if (!process.argv.includes('--approve')) process.exit(0);
const approved = await api(`/experiments/${experimentId}/approve`, { requestId: ids.approveRequestId, expectedRevision: experiment.revision });
await write('phase2-approval-receipt.json', approved);
console.log('Approved:', approved.generationReview?.status);
