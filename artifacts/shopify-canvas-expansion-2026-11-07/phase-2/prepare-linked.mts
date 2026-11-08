/** Prepare a review-only run. This script has no approval or generation calls. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { linkedCanvasesInstructions } from '../../../domain/mapping/evals/linkedCanvases';
import { defaultPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';
const out = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:5191';
const experimentId = '2c9f0ce0-2b7e-42cb-aa4d-a2302f13fd08';
const api = async (route: string, body?: unknown) => {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw Error(await response.text());
  return response.json();
};
const save = async (file: string, value: unknown) => writeFile(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
const read = async (file: string) => JSON.parse(await readFile(path.join(out, file), 'utf8'));
const experiment = await api('/api/mapping/evals/experiments/' + experimentId);
if (experiment.plannedRuns.some((p: any) => p.request.workflow === 'linked-canvases')) throw Error('Phase 2 already prepared. Read its review record instead of adding another run.');
const runs = await api('/api/mapping/evals/runs');
const inputCases = experiment.cases.filter((c: any) => /^shopify-\d\d$/.test(c.id));
const manifest = inputCases.map((c: any) => {
  const candidates = experiment.samples.filter((s: any) => s.caseId === c.id && s.phaseId === 'phase-1').sort((a: any, b: any) => b.attempt - a.attempt);
  for (const sample of candidates) for (const output of sample.outputs) {
    const run = runs.find((r: any) => r.id === output.runId), cell = run?.cells.find((cell: any) => cell.key === output.cellKey);
    if (cell?.status === 'finished' && cell.canvasId && cell.checkpointId && !cell.deleted) return { caseId: c.id, subject: c.name, agentContextId: c.agentContextId, contentHash: c.contentHash,
      runId: run.id, cellKey: cell.key, prompt: run.request.prompts, source: { documentId: cell.canvasId, checkpointId: cell.checkpointId } };
  }
  return { caseId: c.id, subject: c.name, missing: true };
});
const available = manifest.filter((c: any) => c.source);
if (available.length !== 9 || manifest.filter((c: any) => c.missing).map((c: any) => c.caseId).join() !== 'shopify-04') throw Error('Phase 1 changed. Review the selected inputs before saving.');
await save('linked-inputs.json', manifest);
const contextRequest = await read('linked-context.request.json').catch(() => ({ requestId: crypto.randomUUID(), name: 'Shopify - nine canvases for inter-canvas navigation',
  group: 'Shopify - inter-canvas navigation - 2026-11-07', description: 'Nine pinned completed Phase 1 outputs; Buyer Network excluded by user choice because generation failed. Exact canvas contents are supplied in canvases.json.',
  context: [{ type: 'section', name: 'Phase 1 input provenance', content: [{ type: 'text', text: JSON.stringify({ experimentId, inputs: manifest }, null, 2) }] }] }));
await save('linked-context.request.json', contextRequest);
const context = await api('/api/mapping/agent/tools/create-agent-context', contextRequest); await save('linked-context.json', context);
const original = (await readFile(path.join(out, 'task.v1.txt'), 'utf8')).split('\n\nReview draft only;')[0];
const body = `<agent context>
Read context.json for the Phase 1 input provenance and canvases.json for the complete nine pinned canvases, keyed c1 through c9. The first input, c1, is Shopify Company Map. These are generated outputs from the same experiment, including their exact diagrams, evidence labels, positions, edges, and jumps. Use only these inputs. No layout template or few-shot references are supplied. No repository inspection or external research.
Buyer Network (Shopify 04) failed in Phase 1 and is explicitly excluded from this run at the user's request. Do not invent its missing canvas or create a jump to it. Existing references to that missing subject may remain clearly identified as text without a jump.
</agent context>

<task>
${original}

Operate on the nine supplied canvases as one set. Use the Company Map canvas (c1) and its central Company Map diagram as the entry point. Modify or regenerate that central diagram to provide useful navigation. Keep important subjects near the root; prefer a short path through the containing subject for finer detail where that improves comprehension. All eight other included canvases must be reachable from Company Map by directed jumps, but a direct root link to every canvas is not required. Explain the topology and any tradeoff between importance, hierarchy, and visual clutter. Navigation does not establish causal or evidential relationships.
Preserve all nine canvases and their supporting diagrams. Make limited text changes needed for navigation, concentrating changes in the Company Map central diagram; preserve its identity and repair internal edge anchors as needed. Retain evidence tags [R]/[S]/[I]/[X], relation grades, dates, uncertainty, and factual meaning. Do not add new factual conclusions or a tenth canvas. Preserve useful existing inter-canvas links explicitly in the complete returned jumps array. Treat references to excluded Buyer Network as unavailable, not as a tenth navigable canvas.
</task>

<output format>
${linkedCanvasesInstructions}
For this run, return exactly nine existing canvases, each referencing one supplied c1–c9 key, and no new canvases. Set rootCanvas to the output-local ID corresponding to c1. Return one complete linked output, including unchanged target canvases. The application preserves before/after snapshots without altering Phase 1 outputs. In explanation, note the excluded Buyer Network input and explain the chosen navigation.
</output format>`;
await writeFile(path.join(out, 'linked-prompt.v1.txt'), body + '\n');
const promptRequest = await read('linked-prompt.request.json').catch(() => ({ requestId: crypto.randomUUID(), workflow: 'linked-canvases', name: 'Shopify - inter-canvas navigation',
  description: 'Phase 2: link the nine completed Phase 1 canvases from the Company Map root. Buyer Network is excluded explicitly.',
  note: 'New multi-canvas workflow. Input lineage is pinned by Phase 1 run IDs and checkpoints; this is a subsequent task, not a single-canvas prompt variation.',
  templateBase: defaultPromptTemplateBase, stages: { linked: body } }));
await save('linked-prompt.request.json', promptRequest);
const prompt = await read('linked-prompt.json').catch(() => api('/api/mapping/evals/prompts', promptRequest)); await save('linked-prompt.json', prompt);
const fields = ['name', 'description', 'workflow', 'phases', 'cases', 'conditions', 'plannedRuns', 'samples', 'comparisons'];
const design = Object.fromEntries(fields.filter(k => experiment[k] !== undefined).map(k => [k, structuredClone(experiment[k])]));
const phase = design.phases.find((p: any) => p.id === 'phase-2');
phase.name = 'Inter-canvas navigation';
phase.description = 'Prepared for review, not started. One gpt-6-astra/high sample produces a linked set from nine pinned completed Phase 1 canvases, with Company Map as root. Buyer Network failed and is excluded by user choice. The complete task and span-level jump contract are visible in the pinned prompt. ' + original;
design.workflow = { ...design.workflow, name: 'Generate and link canvases', version: design.workflow.version + 1, stages: [{ id: 'split', name: 'Generate output', dependsOn: [] }] };
design.cases.push({ id: 'shopify-linked-nine', name: 'Nine completed Shopify canvases', agentContextId: context.agentContextId, contentHash: context.contentHash });
design.conditions.push({ id: 'shopify-navigation', name: 'Company Map rooted navigation', description: `Linked canvas set; prompt ${prompt.id} v1. Nine existing canvases, one saved output; Buyer Network excluded.` });
design.samples.push({ id: 'shopify-linked-nine-sample-1', phaseId: 'phase-2', caseId: 'shopify-linked-nine', conditionId: 'shopify-navigation', number: 1, attempt: 1, outputs: [] });
const requestId = crypto.randomUUID();
design.plannedRuns.push({ request: { requestId, workflow: 'linked-canvases', prompts: [{ promptId: prompt.id, version: 1 }],
  inputs: { context: { agentContextId: context.agentContextId } }, canvasSources: available.map((c: any) => c.source), passes: 1, model: 'gpt-6-astra', effort: 'high' },
  outputs: [{ sampleId: 'shopify-linked-nine-sample-1', stageId: 'split', cellKey: `${prompt.id}:1:linked` }] });
const request = { requestId: crypto.randomUUID(), experimentId, expectedRevision: experiment.revision, experiment: design };
await save('linked-experiment.request.json', request);
const saved = await api('/api/mapping/evals/experiments', request); await save('linked-experiment.json', saved);
if (saved.generationReview.status !== 'awaiting-approval' || saved.generationReview.runs.length !== 1 || saved.generationReview.runs[0].canvasInputs.length !== 9) throw Error('Unexpected review state');
if (JSON.stringify(saved.samples.slice(0, 10)) !== JSON.stringify(experiment.samples)) throw Error('Phase 1 changed');
if ((await api('/api/mapping/evals/runs')).some((r: any) => r.id === requestId)) throw Error('Phase 2 unexpectedly entered execution');
const proof = { experimentId, revision: saved.revision, status: saved.generationReview.status, workflow: 'linked-canvases', inputCanvases: 9, outputSets: 1,
  promptId: prompt.id, promptVersion: 1, model: 'gpt-6-astra', effort: 'high', phase2Started: false,
  reviewUrl: base + '/evals?experiment=' + experimentId + '&view=overview&phase=phase-2' };
await save('linked-verification.json', proof); console.log(JSON.stringify(proof, null, 2));
